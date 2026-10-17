import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { VolumeAssignment } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';
import { SecretBroker } from '../workloads/secret-broker.service';
import { cryptName, drbdResourceName, renderDrbdResource } from './drbd.renderer';

export interface StorageConfig {
  volumeGroup: string;
  thinPool: string;
  drbdConfigDir: string;
  mountRoot: string;
}

export function storageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  return {
    volumeGroup: env['LOADWEAVER_STORAGE_VG'] || 'loadweaver',
    thinPool: env['LOADWEAVER_STORAGE_THINPOOL'] || 'pool',
    drbdConfigDir: env['LOADWEAVER_DRBD_CONFIG_DIR'] || '/etc/drbd.d',
    mountRoot: env['LOADWEAVER_VOLUME_ROOT'] || '/var/lib/loadweaver/volumes',
  };
}

const MANAGED_FILE = /^lw-(\d+)\.res$/;

/**
 * Replicated, encrypted volumes on this node (3.5, 3.22): LVM thin LV → LUKS2 (key from the secrets system) →
 * DRBD 9. Volumes stay secondary until a workload mounts them on the node the control plane chose as primary.
 */
@Injectable()
export class VolumeManager {
  private readonly logger = new Logger(VolumeManager.name);
  private assignments = new Map<string, VolumeAssignment>();
  private node = '';

  constructor(
    private readonly commands: CommandRunner,
    private readonly secrets: SecretBroker,
  ) {}

  lv(volume: VolumeAssignment, config = storageConfig()): string {
    return `/dev/${config.volumeGroup}/${drbdResourceName(volume)}`;
  }

  mountpoint(volume: VolumeAssignment, config = storageConfig()): string {
    return join(config.mountRoot, volume.dockerName);
  }

  byDockerName(name: string): VolumeAssignment | undefined {
    return [...this.assignments.values()].find((v) => v.dockerName === name);
  }

  async apply(node: string, volumes: VolumeAssignment[]): Promise<boolean> {
    const config = storageConfig();
    let changed = false;

    this.node = node;

    for (const volume of volumes) changed = (await this.ensure(volume, config)) || changed;

    changed = (await this.removeStale(volumes, config)) || changed;
    this.assignments = new Map(volumes.map((v) => [v.id, v]));

    return changed;
  }

  private async ensure(volume: VolumeAssignment, config: StorageConfig): Promise<boolean> {
    let changed = false;
    const lv = this.lv(volume, config);
    const lvName = drbdResourceName(volume);
    const existing = await this.commands.json<{ report: { lv: { lv_name: string }[] }[] }>('lvs', [
      '--reportformat',
      'json',
      '-o',
      'lv_name',
      config.volumeGroup,
    ]);

    if (!existing.report[0]?.lv.some((l) => l.lv_name === lvName)) {
      await this.commands.run('lvcreate', [
        '-y',
        '-V',
        `${volume.sizeBytes}b`,
        '-T',
        `${config.volumeGroup}/${config.thinPool}`,
        '-n',
        lvName,
      ]);
      changed = true;
    }

    let fresh = false;

    try {
      await this.commands.run('cryptsetup', ['isLuks', lv]);
    } catch {
      const key = await this.secrets.fetch(`volume:${volume.id}`, volume.keyRef);

      try {
        await this.commands.run('cryptsetup', ['luksFormat', '--type', 'luks2', '-q', '--key-file', '-', lv], {
          input: key,
        });
      } finally {
        key.fill(0);
      }

      fresh = true;
      changed = true;
    }

    const mapped = await this.commands.run('dmsetup', ['info', cryptName(volume)], { okExitCodes: [1] });

    if (!mapped.stdout.includes('ACTIVE')) {
      const key = await this.secrets.fetch(`volume:${volume.id}`, volume.keyRef);

      try {
        await this.commands.run('cryptsetup', ['open', '--type', 'luks2', '--key-file', '-', lv, cryptName(volume)], {
          input: key,
        });
      } finally {
        key.fill(0);
      }

      changed = true;
    }

    const file = join(config.drbdConfigDir, `${drbdResourceName(volume)}.res`);
    const rendered = renderDrbdResource(volume);
    const current = await readFile(file, 'utf8').catch(() => null);

    if (current !== rendered) {
      await writeFile(file, rendered, { mode: 0o600 });
      changed = true;
    }

    if (fresh) await this.commands.run('drbdadm', ['create-md', '--force', drbdResourceName(volume)]);

    const status = await this.commands.run('drbdsetup', ['status', drbdResourceName(volume)], { okExitCodes: [10] });

    if (status.stdout.trim() === '' || status.stderr.includes('No such resource')) {
      await this.commands.run('drbdadm', ['up', drbdResourceName(volume)]);
      changed = true;
    } else if (current !== rendered) {
      await this.commands.run('drbdadm', ['adjust', drbdResourceName(volume)]);
    }

    return changed;
  }

  /** Removes replicas the control plane moved away; data elsewhere is unaffected (3.2). */
  private async removeStale(volumes: VolumeAssignment[], config: StorageConfig): Promise<boolean> {
    const wanted = new Set(volumes.map((v) => v.minor));
    const files = await readdir(config.drbdConfigDir).catch(() => [] as string[]);
    let changed = false;

    for (const file of files) {
      const match = MANAGED_FILE.exec(file);

      if (!match || wanted.has(Number(match[1]))) continue;

      const minor = Number(match[1]);
      const name = `lw-${minor}`;

      await this.commands.run('drbdadm', ['down', name], { okExitCodes: [10, 11] });
      await this.commands.run('cryptsetup', ['close', `${name}-crypt`], { okExitCodes: [4] });
      await this.commands.run('lvremove', ['-y', `${config.volumeGroup}/${name}`], { okExitCodes: [5] });
      await rm(join(config.drbdConfigDir, file), { force: true });
      this.logger.log(`Removed volume replica ${name}`);
      changed = true;
    }

    return changed;
  }

  /** Promotes and mounts a volume for a workload; only on the node the control plane chose (no split brain). */
  async mount(dockerName: string): Promise<string> {
    const volume = this.byDockerName(dockerName);

    if (!volume) throw new Error(`unknown volume ${dockerName}`);

    if (volume.primary !== this.node) throw new Error(`volume ${dockerName} is primary on ${volume.primary}, not here`);

    const device = `/dev/drbd${volume.minor}`;
    const mountpoint = this.mountpoint(volume);

    await this.commands.run('drbdadm', ['primary', drbdResourceName(volume)]);

    const probe = await this.commands.run('blkid', ['-p', '-o', 'value', '-s', 'TYPE', device], { okExitCodes: [2] });

    if (probe.stdout.trim() === '')
      await this.commands.run('mkfs.ext4', ['-q', '-L', drbdResourceName(volume), device]);

    await mkdir(mountpoint, { recursive: true, mode: 0o711 });

    const mounts = await readFile('/proc/self/mounts', 'utf8').catch(() => '');

    if (!mounts.split('\n').some((l) => l.split(' ')[1] === mountpoint))
      await this.commands.run('mount', ['-o', 'nodev,nosuid', device, mountpoint]);

    return mountpoint;
  }

  async unmount(dockerName: string): Promise<void> {
    const volume = this.byDockerName(dockerName);

    if (!volume) return;

    await this.commands.run('umount', [this.mountpoint(volume)], { okExitCodes: [32] });
    await this.commands.run('drbdadm', ['secondary', drbdResourceName(volume)], { okExitCodes: [11] });
  }
}
