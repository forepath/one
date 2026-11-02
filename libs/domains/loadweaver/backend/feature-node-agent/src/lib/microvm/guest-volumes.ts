import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { volumeDockerName } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';
import { VolumeManager } from '../volumes/volume.manager';
import type { GuestVolume } from '../workloads/workload-container';
import { parseMountinfo } from './rootfs-cache';

/**
 * Filesystem volumes of generic microVMs (M7 W10b). Instead of Docker volume mounts below the image root, the agent
 * mounts each volume (promoted here, as the volume plugin did) at `<dir>/<index>`, where `<dir>` is a per-replica
 * tmpfs directory made a shared mount and bind-mounted `rslave` at `/lwvol` in the launcher: a volume mounted or
 * unmounted later propagates into the running launcher. That is what a live migration needs: during the freeze the
 * source's volume virtiofsd goes, the source unmounts and demotes, the target promotes and mounts into its already
 * running (incoming) launcher, and the image root's virtiofsd never held a volume file.
 */
@Injectable()
export class GuestVolumes {
  private readonly logger = new Logger(GuestVolumes.name);

  constructor(
    private readonly commands: CommandRunner,
    private readonly volumes: VolumeManager,
  ) {}

  private async mounted(path: string): Promise<boolean> {
    const mountinfo = await readFile('/proc/self/mountinfo', 'utf8').catch(() => '');

    return parseMountinfo(mountinfo).some((m) => m.mountPoint === path);
  }

  /** The shared directory with a mount point per volume (idempotent). */
  async prepareDir(dir: string, volumes: readonly GuestVolume[]): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o711 });

    if (!(await this.mounted(dir))) {
      await this.commands.run('mount', ['--bind', dir, dir]);
      await this.commands.run('mount', ['--make-shared', dir]);
    }

    for (const volume of volumes) await mkdir(join(dir, String(volume.index)), { recursive: true, mode: 0o755 });
  }

  /**
   * Mounts a volume into the directory: promoted and mounted through the volume manager (only where the control
   * plane made it primary), or — `takeOver` — taken over during a migration's freeze.
   */
  async attach(dir: string, volume: GuestVolume, takeOver = false): Promise<void> {
    const point = join(dir, String(volume.index));

    if (await this.mounted(point)) return;

    const source = takeOver
      ? await this.volumes.takeOverForMigration(volume.volume)
      : await this.volumes.mount(volumeDockerName(volume.volume));

    await mkdir(point, { recursive: true, mode: 0o755 });
    await this.commands.run('mount', ['--bind', source, point]);

    if (volume.readOnly) await this.commands.run('mount', ['-o', 'remount,bind,ro', point]);
  }

  /**
   * Unmounts a volume from the directory (the unmount propagates into the launcher and fails while a virtiofsd there
   * still holds it), then lets go of it: `migration` strictly (hand-over), `remove` as the volume plugin did.
   */
  async detach(dir: string, volume: GuestVolume, mode: 'migration' | 'remove'): Promise<void> {
    await this.commands.run('umount', [join(dir, String(volume.index))], { okExitCodes: [32] });

    if (mode === 'migration') await this.volumes.releaseForMigration(volume.volume);
    else await this.volumes.unmount(volumeDockerName(volume.volume));
  }

  /** Replica removed: every volume unmounted and demoted, the directory gone. */
  async release(dir: string, volumes: readonly GuestVolume[]): Promise<void> {
    for (const volume of [...volumes].reverse())
      await this.detach(dir, volume, 'remove').catch((error: unknown) =>
        this.logger.warn(`Releasing ${volume.volume}: ${error instanceof Error ? error.message : String(error)}`),
      );

    const mountinfo = parseMountinfo(await readFile('/proc/self/mountinfo', 'utf8').catch(() => ''));

    // A volume still mounted below: never delete through it (the next removal retries).
    if (mountinfo.some((m) => m.mountPoint.startsWith(`${dir}/`))) {
      this.logger.warn(`${dir}: volumes still mounted, left in place`);

      return;
    }

    if (mountinfo.some((m) => m.mountPoint === dir)) await this.commands.run('umount', [dir]);

    await rm(dir, { recursive: true, force: true });
  }
}
