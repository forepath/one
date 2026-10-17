import { hkdfSync } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { VolumeAssignment } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger } from '@nestjs/common';

import { CommandError, CommandRunner } from '../host/command-runner';
import { SecretBroker } from '../workloads/secret-broker.service';
import { cryptName, drbdHost, drbdResourceName, renderDrbdResource, renderedNodeIds } from './drbd.renderer';

export interface StorageConfig {
  volumeGroup: string;
  thinPool: string;
  drbdConfigDir: string;
  mountRoot: string;
  /** tmpfs directory for the short-lived LUKS volume key file of `luksFormat` (never on disk). */
  keyTmpfs: string;
}

export function storageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  return {
    volumeGroup: env['LOADWEAVER_STORAGE_VG'] || 'loadweaver',
    thinPool: env['LOADWEAVER_STORAGE_THINPOOL'] || 'pool',
    drbdConfigDir: env['LOADWEAVER_DRBD_CONFIG_DIR'] || '/etc/drbd.d',
    mountRoot: env['LOADWEAVER_VOLUME_ROOT'] || '/var/lib/loadweaver/volumes',
    keyTmpfs: env['LOADWEAVER_KEY_TMPFS'] || '/run/loadweaver',
  };
}

const MANAGED_FILE = /^lw-(\d+)\.res$/;

/** An adjust (and the peers to forget after it) that didn't complete yet; unreadable markers count as none. */
async function readPending(path: string): Promise<{ adjust: boolean; forget: number[] } | null> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as { adjust?: unknown; forget?: unknown };

    return {
      adjust: raw.adjust === true,
      forget: Array.isArray(raw.forget)
        ? raw.forget.filter((id): id is number => Number.isInteger(id) && id >= 0 && id < 32)
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * Bitmap slots reserved in the DRBD metadata: one per possible peer (a volume has at most 8 replicas), so replicas
 * can be added or moved later without re-creating the metadata (DRBD sizes it for the configured peers otherwise).
 */
const DRBD_MAX_PEERS = 7;

/**
 * LUKS2 data layout of new replicas, identical on every node: with the same volume key (derived from the volume's
 * secret) the same plaintext gives the same ciphertext, and blocks never written through DRBD (zeros in the thin
 * LV) decrypt to the same data on every replica, so online verify stays clean without an initial full sync.
 *
 * The key slot uses PBKDF2 with the minimum iterations: its passphrase is the volume's machine-generated secret, from
 * which the volume key is derived directly anyway, so a slow KDF adds no protection; Argon2id's default memory cost
 * (up to half the RAM) made `luksFormat` / `open` fail on small, busy nodes (VM lab, 1 GiB guests).
 */
export const LUKS_FORMAT = [
  '--cipher',
  'aes-xts-plain64',
  '--key-size',
  '512',
  '--sector-size',
  '4096',
  '--offset',
  '32768',
  '--pbkdf',
  'pbkdf2',
  '--pbkdf-force-iterations',
  '1000',
];

/** cryptsetup can take long on busy nodes (volumes from before PBKDF2 unlock with Argon2id). */
export const CRYPTSETUP_TIMEOUT_MS = 120_000;
const VOLUME_KEY_BYTES = 64;

/** Linux `statfs` magic numbers of memory-backed file systems (`TMPFS_MAGIC`, `RAMFS_MAGIC`). */
const MEMORY_FS = new Set([0x01021994, 0x858458f6]);

/**
 * The LUKS volume (master) key of a volume, the same on every replica: HKDF-SHA256 over the volume's key material
 * from the secrets system, bound to the volume id. The passphrase protecting the key slot stays the secret itself.
 */
export function volumeKey(material: Buffer, volumeId: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', material, 'loadweaver/luks2-volume-key/v1', `volume:${volumeId}`, VOLUME_KEY_BYTES),
  );
}

/** DRBD's current-UUID of metadata that never held data (`UUID_JUST_CREATED`). */
const JUST_CREATED_UUID = /^0{15}4$/;

interface DrbdStatus {
  role: string;
  devices: { 'disk-state': string }[];
  connections: { name: string; 'connection-state': string; peer_devices: { 'peer-disk-state': string }[] }[];
}

/**
 * Replicated, encrypted volumes on this node (3.5, 3.22): LVM thin LV → LUKS2 (key from the secrets system) →
 * DRBD 9. Volumes stay secondary until a workload mounts them on the node the control plane chose as primary.
 */
@Injectable()
export class VolumeManager {
  private readonly logger = new Logger(VolumeManager.name);
  private assignments = new Map<string, VolumeAssignment>();
  private node = '';
  /** cryptsetup's option for a given volume key (`--master-key-file` before cryptsetup 2.5). */
  private volumeKeyOption?: string;
  /** Volume id → removed peers whose `forget-peer` failed in the last reconcile (pending marker keeps them). */
  private readonly forgetFailures = new Map<string, { peers: number[]; error: string }>();

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

  /** Where a volume is mounted on this node (as its primary), for the file browser (3.19); null otherwise. */
  async mountedPath(volumeId: string, config = storageConfig()): Promise<string | null> {
    const volume = this.assignments.get(volumeId);

    if (!volume || volume.primary !== this.node) return null;

    const path = this.mountpoint(volume, config);
    const mounts = await readFile('/proc/self/mountinfo', 'utf8').catch(() => '');

    // Field 5 of each line is the mount point (spaces escaped as \040).
    return mounts.split('\n').some((line) => line.split(' ')[4]?.replace(/\\040/g, ' ') === path) ? path : null;
  }

  /** The assignment of a volume this node holds a replica of (last apply). */
  assignment(volumeId: string): VolumeAssignment | undefined {
    return this.assignments.get(volumeId);
  }

  /** This node's name (last apply). */
  nodeName(): string {
    return this.node;
  }

  byDockerName(name: string): VolumeAssignment | undefined {
    return [...this.assignments.values()].find((v) => v.dockerName === name);
  }

  async apply(node: string, volumes: VolumeAssignment[]): Promise<boolean> {
    const config = storageConfig();
    let changed = false;

    this.node = node;

    const failures: string[] = [];

    // One broken volume must not keep the others (or the removal of stale replicas) from converging.
    for (const volume of volumes) {
      try {
        changed = (await this.ensure(volume, config)) || changed;
      } catch (error) {
        failures.push(`${volume.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    changed = (await this.removeStale(volumes, config)) || changed;
    this.assignments = new Map(volumes.map((v) => [v.id, v]));

    for (const id of this.forgetFailures.keys()) if (!this.assignments.has(id)) this.forgetFailures.delete(id);

    if (failures.length) throw new Error(`volumes not converged: ${failures.join('; ')}`);

    return changed;
  }

  private async ensure(volume: VolumeAssignment, config: StorageConfig): Promise<boolean> {
    let changed = false;
    const lv = this.lv(volume, config);
    const lvName = drbdResourceName(volume);
    const lvState = await this.lvState(config, lvName);

    if (lvState && lvState.lv_active !== 'active') {
      await this.activate(config, lvName);
      changed = true;
    }

    if (!lvState) {
      await this.commands.run('lvcreate', [
        '-y',
        // Activates an inactive pool first: the same thin_check options as `activate`.
        '--config',
        VolumeManager.THIN_CHECK_CONFIG,
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

    if (!(await this.isLuks(lv))) {
      await this.luksFormat(volume, lv, config);
      fresh = true;
      changed = true;
    }

    const mapped = await this.commands.run('dmsetup', ['info', cryptName(volume)], { okExitCodes: [1] });

    if (!mapped.stdout.includes('ACTIVE')) {
      const key = await this.secrets.fetch(`volume:${volume.id}`, volume.keyRef);

      try {
        await this.commands.run('cryptsetup', ['open', '--type', 'luks2', '--key-file', '-', lv, cryptName(volume)], {
          input: key,
          timeoutMs: CRYPTSETUP_TIMEOUT_MS,
        });
      } finally {
        key.fill(0);
      }

      changed = true;
    }

    const file = join(config.drbdConfigDir, `${drbdResourceName(volume)}.res`);
    const rendered = renderDrbdResource(volume);
    const current = await readFile(file, 'utf8').catch(() => null);
    // Peers that left the volume (replica removed or moved): their bitmap slots are freed once DRBD dropped them.
    const own = volume.replicas.find((r) => r.node === this.node)?.nodeId;
    const kept = new Set(volume.replicas.map((r) => r.nodeId));
    // A config change is only done once `adjust` succeeded: until then a pending marker (outside drbd.conf's
    // `*.res` include) keeps the adjust and the peers to forget, so a failed or interrupted adjust is retried.
    const pendingFile = `${file}.pending`;
    const pending = await readPending(pendingFile);
    const removedPeers = [...new Set([...(current ? renderedNodeIds(current).keys() : []), ...(pending?.forget ?? [])])]
      .filter((id) => !kept.has(id) && id !== own)
      .sort((a, b) => a - b);
    const needsAdjust = current !== rendered || !!pending?.adjust;

    if (needsAdjust || removedPeers.length)
      await writeFile(pendingFile, JSON.stringify({ adjust: needsAdjust, forget: removedPeers }), { mode: 0o600 });

    if (current !== rendered) {
      await writeFile(file, rendered, { mode: 0o600 });
      changed = true;
    }

    if (fresh) await this.createMetadata(volume);

    const status = await this.drbdStatus(volume);

    if (!status) {
      await this.bringUp(volume, 'up');
      changed = true;
    } else if (status.devices[0]?.['disk-state'] === 'Diskless') {
      // A failed attach (or detach after I/O errors) leaves the resource up without its disk.
      await this.bringUp(volume, 'adjust');
      changed = true;
    } else if (needsAdjust) {
      await this.commands.run('drbdadm', ['adjust', drbdResourceName(volume)]);
    }

    const unforgotten: number[] = [];
    let forgetError = '';

    for (const peer of removedPeers) {
      const error = await this.forgetPeer(volume, peer);

      if (error !== null) {
        unforgotten.push(peer);
        forgetError = error;
      }
    }

    if (unforgotten.length) {
      // The adjust is done; the marker keeps only the peers still to forget, retried on the next reconcile.
      await writeFile(pendingFile, JSON.stringify({ adjust: false, forget: unforgotten }), { mode: 0o600 });
      this.forgetFailures.set(volume.id, { peers: unforgotten, error: forgetError });
    } else {
      await rm(pendingFile, { force: true });
      this.forgetFailures.delete(volume.id);
    }

    return changed;
  }

  /**
   * Volumes whose removed peers' bitmap slots could not be freed yet (`forget-peer` failed; retried on every
   * reconcile until it succeeds or the peer is a replica again), for the node's apply report; undefined when none.
   */
  forgetPeerWarning(): string | undefined {
    if (this.forgetFailures.size === 0) return undefined;

    const volumes = [...this.forgetFailures]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, { peers, error }]) => `${id} (node-id ${peers.join(', ')}: ${error})`);

    return `DRBD forget-peer pending, retried on the next reconcile: ${volumes.join('; ')}`;
  }

  /**
   * Frees the bitmap slot of a peer that no longer holds a replica (`drbdsetup forget-peer`), after `adjust`
   * disconnected and removed it: the metadata has 7 slots, and a forgotten slot can serve a later replica. Idempotent:
   * DRBD 9.2.20 accepts forgetting an already-forgotten slot (exit 0, VM lab), e.g. after an interrupted run couldn't
   * clear its marker; an "invalid peer-node-id" answer (other DRBD versions) counts as forgotten too. Returns the error of a failed attempt (null when done); the caller
   * keeps such peers pending and retries them on the next reconcile.
   */
  private async forgetPeer(volume: VolumeAssignment, nodeId: number): Promise<string | null> {
    try {
      await this.commands.run('drbdsetup', ['forget-peer', drbdResourceName(volume), String(nodeId)]);
      this.logger.log(`Volume ${volume.id}: forgot removed peer node-id ${nodeId}`);

      return null;
    } catch (error) {
      const text = error instanceof CommandError ? `${error.message} ${error.stderr}` : String(error);

      if (/invalid peer[- ]node[- ]id/i.test(text)) return null;

      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 200);

      this.logger.warn(`Volume ${volume.id}: forget-peer ${nodeId} failed (retried on the next reconcile): ${reason}`);

      return reason;
    }
  }

  /**
   * `luksFormat` with the volume's shared volume key (`volumeKey`), so every replica encrypts identically. The key
   * reaches cryptsetup through a file on tmpfs (cryptsetup reads volume keys only from files), readable by root only
   * and removed right after; the passphrase goes through stdin.
   */
  private async luksFormat(volume: VolumeAssignment, lv: string, config: StorageConfig): Promise<void> {
    const material = await this.secrets.fetch(`volume:${volume.id}`, volume.keyRef);
    const key = volumeKey(material, volume.id);

    await mkdir(config.keyTmpfs, { recursive: true, mode: 0o700 });
    await this.assertMemoryFs(config.keyTmpfs);

    const dir = await mkdtemp(join(config.keyTmpfs, 'luks-'));
    const keyFile = join(dir, 'volume.key');

    try {
      await writeFile(keyFile, key, { mode: 0o600, flag: 'wx' });
      await this.commands.run(
        'cryptsetup',
        [
          'luksFormat',
          '--type',
          'luks2',
          '-q',
          ...LUKS_FORMAT,
          await this.volumeKeyFileOption(),
          keyFile,
          '--key-file',
          '-',
          lv,
        ],
        { input: material, timeoutMs: CRYPTSETUP_TIMEOUT_MS },
      );
    } finally {
      await writeFile(keyFile, Buffer.alloc(VOLUME_KEY_BYTES)).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
      key.fill(0);
      material.fill(0);
    }
  }

  /** Refuses to write key material anywhere but a memory file system. */
  async assertMemoryFs(dir: string): Promise<void> {
    const fs = await statfs(dir);

    if (!MEMORY_FS.has(Number(fs.type))) throw new Error(`${dir} is not tmpfs; refusing to write a volume key there`);
  }

  /** cryptsetup's option naming a volume key file (`--volume-key-file`, `--master-key-file` before 2.5). */
  async volumeKeyFileOption(): Promise<string> {
    if (!this.volumeKeyOption) {
      const help = await this.commands.run('cryptsetup', ['--help'], { okExitCodes: [1] }).catch(() => null);

      this.volumeKeyOption =
        help && !help.stdout.includes('--volume-key-file') && help.stdout.includes('--master-key-file')
          ? '--master-key-file'
          : '--volume-key-file';
    }

    return this.volumeKeyOption;
  }

  private async lvState(config: StorageConfig, lvName: string) {
    const existing = await this.commands.json<{ report: { lv: { lv_name: string; lv_active?: string }[] }[] }>('lvs', [
      '--reportformat',
      'json',
      '-o',
      'lv_name,lv_active',
      config.volumeGroup,
    ]);

    return existing.report[0]?.lv.find((l) => l.lv_name === lvName);
  }

  /**
   * thin_check options for activations by the agent: a power cut can leave leaked data blocks in the pool's space map
   * (allocated, mapped by nothing — wasted space, no data loss), which LVM's default `thin_check` reports as status 64
   * and refuses the pool ("Manual repair required!"; VM lab, after a crash). Non-fatal errors are accepted; damaged
   * mappings or metadata still fail the check.
   */
  static readonly THIN_CHECK_CONFIG =
    'global { thin_check_options = [ "-q", "--clear-needs-check-flag", "--ignore-non-fatal-errors" ] }';

  /** Pause between activation attempts (tests set it to 0). */
  protected activationRetryMs = 2000;

  /**
   * Activates an LV LVM hasn't activated yet, with {@link VolumeManager.THIN_CHECK_CONFIG} (leaked blocks after a
   * crash don't block the pool). Right after boot the agent can be faster than LVM's udev-driven autoactivation, so a
   * failed attempt waits for udev, looks again (autoactivation may have finished meanwhile) and retries a few times
   * before giving up.
   */
  private async activate(config: StorageConfig, lvName: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.commands.run('lvchange', [
          '-ay',
          '--config',
          VolumeManager.THIN_CHECK_CONFIG,
          `${config.volumeGroup}/${lvName}`,
        ]);

        return;
      } catch (error) {
        if (attempt >= 4) throw error;

        this.logger.warn(
          `Activating ${config.volumeGroup}/${lvName} failed (attempt ${attempt}), retrying: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      await this.commands.run('udevadm', ['settle', '--timeout=30'], { timeoutMs: 35_000 }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, this.activationRetryMs * attempt));

      if ((await this.lvState(config, lvName))?.lv_active === 'active') return;
    }
  }

  /**
   * True if `lv` is LUKS. Only a device cryptsetup reports as "not LUKS" (exit 1) that carries no other signature
   * either gets formatted: a missing device, an I/O error or foreign data must never lead to `luksFormat`.
   */
  private async isLuks(lv: string): Promise<boolean> {
    try {
      await this.commands.run('cryptsetup', ['isLuks', lv]);

      return true;
    } catch (error) {
      if (!(error instanceof CommandError) || error.exitCode !== 1) throw error;
    }

    const probe = await this.commands.run('blkid', ['-p', '-o', 'value', '-s', 'TYPE', lv], { okExitCodes: [2] });

    if (probe.stdout.trim() !== '')
      throw new Error(`${lv} holds ${probe.stdout.trim()}, not LUKS; refusing to format it`);

    return false;
  }

  private async createMetadata(volume: VolumeAssignment): Promise<void> {
    await this.commands.run('drbdadm', [
      'create-md',
      `--max-peers=${DRBD_MAX_PEERS}`,
      '--force',
      drbdResourceName(volume),
    ]);
  }

  /**
   * `drbdadm up` / `adjust`; metadata missing although the LUKS device exists means an earlier apply stopped
   * between `luksFormat` and `create-md` (nothing was ever written through DRBD) → create it and attach.
   */
  private async bringUp(volume: VolumeAssignment, command: 'up' | 'adjust'): Promise<void> {
    try {
      await this.commands.run('drbdadm', [command, drbdResourceName(volume)]);
    } catch (error) {
      if (!(error instanceof CommandError) || !/No valid meta data found/i.test(error.stderr)) throw error;

      this.logger.warn(`Volume ${volume.id} has no DRBD metadata yet; creating it`);
      await this.createMetadata(volume);
      await this.commands.run('drbdadm', ['adjust', drbdResourceName(volume)]);
    }
  }

  /** `drbdsetup status --json` of the volume's resource; null if the resource isn't up. */
  private async drbdStatus(volume: VolumeAssignment): Promise<DrbdStatus | null> {
    const result = await this.commands.run('drbdsetup', ['status', drbdResourceName(volume), '--json'], {
      okExitCodes: [10],
    });

    try {
      return (JSON.parse(result.stdout || '[]') as DrbdStatus[])[0] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * A new volume has no UpToDate copy anywhere, so DRBD refuses to promote it. On first use, the primary declares
   * the (empty) data current: with every assigned peer connected and Inconsistent and its own metadata never having
   * held data, `new-current-uuid --clear-bitmap` marks all replicas UpToDate without a full initial sync (thin LVs
   * stay thin; blocks never written through DRBD are not compared). A peer that isn't connected yet blocks this, so
   * a replica with data can never be overruled; one that joins later just-created gets a full sync.
   */
  private async initialiseIfNew(volume: VolumeAssignment): Promise<void> {
    const name = drbdResourceName(volume);
    const status = await this.drbdStatus(volume);

    if (status?.devices[0]?.['disk-state'] !== 'Inconsistent') return;

    // Resync target of an up-to-date peer: DRBD promotes it and reads through the peer.
    if (status.connections.some((c) => c.peer_devices[0]?.['peer-disk-state'] === 'UpToDate')) return;

    const peers = volume.replicas.filter((r) => r.node !== this.node);

    if (peers.length === 0) {
      await this.commands.run('drbdadm', ['primary', '--force', name]);

      return;
    }

    const missing = peers.filter((peer) => {
      // DRBD names connections after the peer's `on` host.
      const connection = status.connections.find((c) => c.name === drbdHost(peer));

      return (
        connection?.['connection-state'] !== 'Connected' ||
        connection.peer_devices[0]?.['peer-disk-state'] !== 'Inconsistent'
      );
    });
    const gi = (await this.commands.run('drbdadm', ['get-gi', name])).stdout.trim().split(':')[0] ?? '';

    if (missing.length || !JUST_CREATED_UUID.test(gi))
      throw new Error(
        `volume ${volume.dockerName} has no up-to-date replica here` +
          (missing.length ? ` (waiting for ${missing.map((p) => p.node).join(', ')})` : ''),
      );

    await this.commands.run('drbdadm', ['new-current-uuid', '--clear-bitmap', `${name}/0`]);
    this.logger.log(`Initialised new volume ${volume.id} (no initial sync)`);
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
      await rm(join(config.drbdConfigDir, `${file}.pending`), { force: true });
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

    await this.initialiseIfNew(volume);
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
