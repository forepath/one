import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  agentMessage,
  backupChannel,
  backupRunSchema,
  restoreRunSchema,
  VOLUME_SNAPSHOT_PATH,
  type BackupPhase,
  type BackupProgress,
  type BackupRun,
  type Envelope,
  type KopiaRepositoryAccess,
  type RestoreRun,
  type VolumeAssignment,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger, Optional } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';
import { MigrationSessions } from '../migration/migration-sessions';
import { routedImage } from '../registry/image-routing';
import { AgentStateStore } from '../state/agent-state.store';
import { drbdResourceName } from '../volumes/drbd.renderer';
import {
  CRYPTSETUP_TIMEOUT_MS,
  LUKS_FORMAT,
  storageConfig,
  volumeKey,
  VolumeManager,
  type StorageConfig,
} from '../volumes/volume.manager';
import { vmReplicaOfVolume, VmPower } from '../vm/vm-power';
import { RESTORED_LABEL } from '../workloads/restored-runtime';
import { SecretBroker } from '../workloads/secret-broker.service';
import { WORKLOAD_LABEL } from '../workloads/workload-container';
import { WorkloadManager } from '../workloads/workload.manager';
import { BackupJobs, JOB_PREFIX, jobName, type JobOutput } from './backup-jobs';
import { kopiaGoMemoryLimit, kopiaImage } from './kopia-server.manager';

export type BackupCommandType = 'backupRun' | 'restoreRun';

/** Results kept for re-sent commands (the control plane re-sends until it got the final report). */
const MAX_RESULTS = 200;
const KOPIA_CONNECT_TIMEOUT_MS = 120_000;
/** Upper bound of one snapshot / restore (a stuck upload must not hold the snapshot forever). */
const KOPIA_RUN_TIMEOUT_MS = 24 * 3600_000;
const KOPIA_MEMORY_BYTES = 1024 ** 3;
const CHECK_MEMORY_BYTES = 1024 ** 3;
const CHECK_OUTPUT_BYTES = 8192;
/** Device-mapper name suffix of a VM disk snapshot's exact-size view. */
const BLOCK_VIEW_SUFFIX = '-disk';
/** Exit code of the path-restore script when the target exists and overwriting wasn't allowed. */
const TARGET_EXISTS = 17;
/** Kopia client of a backup: reads every file of the volume (root in the container, nothing else). */
const BACKUP_CAPS = ['DAC_READ_SEARCH'];
/** Kopia client of a restore: writes files with their owners, modes and times. */
const RESTORE_CAPS = ['CHOWN', 'DAC_OVERRIDE', 'DAC_READ_SEARCH', 'FOWNER', 'FSETID'];
const OVERWRITE = ['--overwrite-files', '--overwrite-directories', '--overwrite-symlinks'];
const NO_OVERWRITE = ['--no-overwrite-files', '--no-overwrite-directories', '--no-overwrite-symlinks'];

/**
 * Backup of a VM disk (block volume, 3.35) inside the Kopia client container (`sh -c <script> sh <device> <args…>`):
 * the read-only snapshot device (exactly the guest's disk) is Kopia's stdin, stored as one file `<vm>.<disk>.raw`
 * (Kopia's content-defined chunking dedups across runs). No pipe: a read error fails Kopia itself.
 */
const BLOCK_BACKUP_SCRIPT = ['set -eu', 'device="$1"; shift', 'exec kopia snapshot create "$@" <"$device"'].join('\n');
/**
 * Restore of a VM disk: the disk file of the snapshot (`<root>/<vm>.<disk>.raw`) written onto the DRBD device (all
 * replicas get it through DRBD). A redirect, not a pipe, so Kopia's exit status is the job's; the last close of the
 * block device flushes it.
 */
const BLOCK_RESTORE_SCRIPT = ['set -eu', 'exec kopia show "$1" >"$2"'].join('\n');

/**
 * Single-path restore inside the Kopia client container (`sh -c <script> sh <target> <source> <overwrite> <flags…>`):
 * the volume is the container's only writable mount, so symbolic links in it resolve inside the container, never on
 * the host. Values arrive as positional parameters, never interpolated.
 */
const PATH_RESTORE_SCRIPT = [
  'set -eu',
  'target="/volume/$1"; source="$2"; overwrite="$3"; shift 3',
  `if [ "$overwrite" != 1 ] && { [ -e "$target" ] || [ -L "$target" ]; }; then echo "target exists" >&2; exit ${TARGET_EXISTS}; fi`,
  'mkdir -p "$(dirname "$target")"',
  'exec kopia restore "$@" "$source" "$target"',
].join('\n');

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

/** Last lines of a failed job's output, for the report. */
function lastLines(output: string, max = 600): string {
  const trimmed = output.trim();

  return trimmed.length > max ? `…${trimmed.slice(-max)}` : trimmed;
}

interface KopiaManifest {
  id: string;
  startTime: string;
  endTime: string;
  rootEntry: { obj: string; summ?: { size?: number; files?: number } };
  stats?: { totalSize?: number; fileCount?: number; uploadedBytes?: number };
}

/** The snapshot manifest `kopia snapshot create --json` prints. */
export function parseSnapshotManifest(stdout: string): KopiaManifest {
  const start = stdout.indexOf('{');
  const manifest = JSON.parse(start >= 0 ? stdout.slice(start) : stdout) as KopiaManifest;

  if (!manifest?.id || !manifest.rootEntry?.obj) throw new Error('kopia printed no snapshot manifest');

  return manifest;
}

export interface BackupPaths {
  /** Kopia client state of running jobs (config, cache, logs), removed afterwards. */
  work: string;
  /** Mount points of snapshots / scratch volumes. */
  mounts: string;
  /** Results of finished jobs (re-sent commands). */
  results: string;
}

export function backupPaths(stateDirectory: string, config: StorageConfig = storageConfig()): BackupPaths {
  return {
    work: join(stateDirectory, 'backups', 'jobs'),
    mounts: join(config.keyTmpfs, 'backups'),
    results: join(stateDirectory, 'backups', 'results.json'),
  };
}

interface Job {
  operation: 'backup' | 'restore';
  phase?: BackupPhase;
}

/** Undo steps of a job, run in reverse order; every step runs even if an earlier one failed. */
class Cleanup {
  private readonly steps: Array<{ what: string; fn: () => Promise<unknown> }> = [];

  add(what: string, fn: () => Promise<unknown>): void {
    this.steps.push({ what, fn });
  }

  async run(logger: Logger): Promise<string[]> {
    const failures: string[] = [];

    for (const step of this.steps.reverse()) {
      try {
        await step.fn();
      } catch (error) {
        failures.push(`${step.what}: ${messageOf(error)}`);
        logger.warn(`Cleanup ${step.what} failed: ${messageOf(error)}`);
      }
    }

    this.steps.length = 0;

    return failures;
  }
}

/**
 * Backups and restores of volumes on this node (3.20; commands `backupRun` / `restoreRun`, reports
 * `backupProgress` on `backup:<id>`).
 *
 * Backup (node holding the volume's primary): pre hook in the replica (`docker exec`) → file system frozen
 * (`fsfreeze`, when mounted here) for an LVM thin snapshot of the LV under LUKS → post hook → the snapshot opened
 * read-only with the volume key (key file on tmpfs, zeroed right after) and mounted read-only without journal replay
 * → Kopia client container (host network, volume read-only at `/volume`, only `DAC_READ_SEARCH`) connects to a
 * repository server as the volume's user with the pinned certificate fingerprint and creates the snapshot. Every
 * step is undone afterwards, also on failure; leftovers of a crashed agent (`lw-bk-*`) are removed at start.
 *
 * Restores: `volume` (containers using the volume stopped and started again, `replace` deletes what the snapshot
 * doesn't have), `path` (one file / directory, never overwriting unless asked), `scratch` (temporary thin LV with a
 * throw-away LUKS key, restore, optional check container, everything removed).
 *
 * Commands are idempotent per id: a re-sent command re-reports the running job or the stored result.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private send: ((envelope: Envelope) => unknown) | null = null;
  private readonly jobs = new Map<string, Job>();
  private readonly results = new Map<string, BackupProgress>();
  private readonly tasks = new Set<Promise<void>>();
  private loaded = false;

  constructor(
    private readonly commands: CommandRunner,
    private readonly volumes: VolumeManager,
    private readonly secrets: SecretBroker,
    private readonly workloads: WorkloadManager,
    private readonly runner: BackupJobs,
    private readonly state: AgentStateStore,
    @Optional() private readonly sessions?: MigrationSessions,
    @Optional() private readonly vms?: VmPower,
  ) {}

  private paths(): BackupPaths {
    return backupPaths(this.state.dir);
  }

  attach(send: (envelope: Envelope) => unknown): void {
    this.send = send;
  }

  /** Waits for running jobs (tests, VM lab driver). */
  async idle(): Promise<void> {
    while (this.tasks.size) await Promise.all([...this.tasks]);
  }

  // Start-up.

  /**
   * At agent start: stored results, then everything a job of a previous agent process left behind (it died with
   * the process; the control plane re-sends the command): job containers, mounts, read-only / scratch mappings,
   * snapshot / scratch LVs, client state and key directories; frozen volume file systems are thawed.
   */
  async recover(): Promise<void> {
    await this.loadResults();

    const config = storageConfig();
    const paths = this.paths();
    const step = async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (error) {
        this.logger.warn(`Backup leftovers (${what}): ${messageOf(error)}`);
      }
    };

    await step('containers', () => this.runner.removeLeftovers());
    await step('mounts', async () => {
      const mounts = await readFile('/proc/self/mounts', 'utf8').catch(() => '');

      for (const line of mounts.split('\n')) {
        const target = line.split(' ')[1]?.replace(/\\040/g, ' ') ?? '';

        if (target.startsWith(`${config.mountRoot}/`))
          await this.commands.run('fsfreeze', ['-u', target], { okExitCodes: [1] }).catch(() => undefined);

        if (target.startsWith(`${paths.mounts}/`)) await this.commands.run('umount', [target], { okExitCodes: [32] });
      }
    });
    await step('mappings', async () => {
      const { stdout } = await this.commands.run('dmsetup', ['info', '-c', '--noheadings', '-o', 'name'], {
        okExitCodes: [1],
      });

      const names = stdout.split('\n').map((l) => l.trim());

      // The exact-size views of VM disk snapshots sit on top of their read-only LUKS mappings: removed first.
      for (const name of names)
        if (name.startsWith(JOB_PREFIX) && name.endsWith(BLOCK_VIEW_SUFFIX))
          await this.commands.run('dmsetup', ['remove', name], { okExitCodes: [1] });

      for (const name of names)
        if (name.startsWith(JOB_PREFIX) && !name.endsWith(BLOCK_VIEW_SUFFIX))
          await this.commands.run('cryptsetup', ['close', name], {
            okExitCodes: [4],
            timeoutMs: CRYPTSETUP_TIMEOUT_MS,
          });
    });
    await step('volumes', async () => {
      const lvs = await this.commands.json<{ report: { lv: { lv_name: string }[] }[] }>('lvs', [
        '--reportformat',
        'json',
        '-o',
        'lv_name',
        config.volumeGroup,
      ]);

      for (const lv of lvs.report[0]?.lv ?? [])
        if (lv.lv_name.startsWith(JOB_PREFIX))
          await this.commands.run('lvremove', ['-y', `${config.volumeGroup}/${lv.lv_name}`], { okExitCodes: [5] });
    });
    await step('directories', async () => {
      await rm(paths.work, { recursive: true, force: true });
      await rm(paths.mounts, { recursive: true, force: true });

      for (const entry of await readdir(config.keyTmpfs).catch(() => [] as string[]))
        if (entry.startsWith(JOB_PREFIX)) await rm(join(config.keyTmpfs, entry), { recursive: true, force: true });
    });
  }

  private async loadResults(): Promise<void> {
    if (this.loaded) return;

    this.loaded = true;

    const raw = await readFile(this.paths().results, 'utf8').catch(() => null);

    if (!raw) return;

    try {
      for (const result of JSON.parse(raw) as BackupProgress[]) this.results.set(result.id, result);
    } catch {
      this.logger.warn('Stored backup results unreadable; starting without them');
    }
  }

  private async storeResult(result: BackupProgress): Promise<void> {
    this.results.delete(result.id);
    this.results.set(result.id, result);

    while (this.results.size > MAX_RESULTS) this.results.delete(this.results.keys().next().value as string);

    const file = this.paths().results;

    await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
    await writeFile(`${file}.tmp`, JSON.stringify([...this.results.values()]), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }

  // Commands.

  /** Entry point (agent connection, VM lab driver): validates and starts the job in the background. */
  async handle(type: BackupCommandType, payload: unknown): Promise<void> {
    await this.loadResults();

    const parsed = type === 'backupRun' ? backupRunSchema.safeParse(payload) : restoreRunSchema.safeParse(payload);
    const operation = type === 'backupRun' ? 'backup' : 'restore';
    const id = (payload as { backup?: string; restore?: string } | null)?.[type === 'backupRun' ? 'backup' : 'restore'];

    if (!parsed.success) {
      if (typeof id === 'string')
        this.report({ id, operation, status: 'failed', error: `invalid ${type}: ${parsed.error.message}` });

      return;
    }

    const stored = this.results.get(id as string);

    if (stored) return void this.report(stored);

    const running = this.jobs.get(id as string);

    if (running) return void this.report({ id: id as string, operation, status: 'running', phase: running.phase });

    const job: Job = { operation };

    this.jobs.set(id as string, job);

    const task = (async () => {
      let result: BackupProgress;

      try {
        result =
          type === 'backupRun'
            ? await this.backup(parsed.data as BackupRun, job)
            : await this.restore(parsed.data as RestoreRun, job);
      } catch (error) {
        result = { id: id as string, operation, status: 'failed', phase: job.phase, error: messageOf(error) };
      }

      await this.storeResult(result).catch((error: unknown) =>
        this.logger.warn(`Storing the result of ${id} failed: ${messageOf(error)}`),
      );
      this.jobs.delete(id as string);
      this.report(result);
    })();

    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task));
  }

  private report(progress: BackupProgress): void {
    const payload: BackupProgress = {
      ...progress,
      ...(progress.error ? { error: progress.error.slice(0, 4096) } : {}),
    };

    this.send?.(agentMessage('backupProgress', payload, { channel: backupChannel(progress.id) }));
  }

  private phase(id: string, job: Job, phase: BackupPhase): void {
    job.phase = phase;
    this.report({ id, operation: job.operation, status: 'running', phase });
  }

  // Backup.

  private primaryVolume(volumeId: string): VolumeAssignment {
    const volume = this.volumes.assignment(volumeId);

    if (!volume) throw new Error(`volume ${volumeId} has no replica on this node`);

    if (volume.primary !== this.volumes.nodeName())
      throw new Error(`volume ${volumeId} is primary on ${volume.primary}, not on this node`);

    return volume;
  }

  /** The local copy must be current: a snapshot of a replica that is still syncing would be inconsistent. */
  private async requireUpToDate(volume: VolumeAssignment): Promise<void> {
    const result = await this.commands.run('drbdsetup', ['status', drbdResourceName(volume), '--json'], {
      okExitCodes: [10],
    });
    let disk: string | undefined;

    try {
      disk = (JSON.parse(result.stdout || '[]') as { devices?: { 'disk-state'?: string }[] }[])[0]?.devices?.[0]?.[
        'disk-state'
      ];
    } catch {
      disk = undefined;
    }

    if (disk !== 'UpToDate') throw new Error(`volume ${volume.id} is not up to date here (${disk ?? 'down'})`);
  }

  private async backup(run: BackupRun, job: Job): Promise<BackupProgress> {
    const volume = this.primaryVolume(run.volume);
    const config = storageConfig();
    const name = jobName(run.backup);
    const cleanup = new Cleanup();

    await this.requireUpToDate(volume);

    if (volume.mode === 'block') return await this.backupBlock(run, job, volume);

    try {
      const hookContainer = run.hooks ? await this.hookContainer(run.hooks.replica) : null;

      if (run.hooks) this.phase(run.backup, job, 'hooks');

      let preError: unknown;
      let snapshotError: unknown;

      if (run.hooks?.pre && hookContainer)
        await this.hook(hookContainer, 'pre', run.hooks.pre, run.hooks.timeoutSeconds).catch((e: unknown) => {
          preError = e;
        });

      if (!preError) {
        this.phase(run.backup, job, 'snapshot');
        await this.snapshotLv(volume, name, config, cleanup).catch((e: unknown) => {
          snapshotError = e;
        });
      }

      // The post hook always follows a pre hook (e.g. it releases a lock), even when the snapshot failed.
      if (run.hooks?.post && hookContainer) {
        try {
          await this.hook(hookContainer, 'post', run.hooks.post, run.hooks.timeoutSeconds);
        } catch (error) {
          if (!preError && !snapshotError) throw error;
        }
      }

      if (preError) throw preError;

      if (snapshotError) throw snapshotError;

      const device = await this.openSnapshot(volume, name, config, cleanup);
      const mountpoint = await this.mountReadOnly(device, name, cleanup);

      this.phase(run.backup, job, 'upload');

      const client = await this.client(name, run.repository, cleanup);
      const created = await this.kopia(
        client,
        `${name}-snapshot`,
        [
          'snapshot',
          'create',
          VOLUME_SNAPSHOT_PATH,
          '--json',
          `--description=${run.description}`,
          ...Object.entries(run.tags).map(([k, v]) => `--tags=${k}:${v}`),
        ],
        { binds: [`${mountpoint}:${VOLUME_SNAPSHOT_PATH}:ro`], caps: BACKUP_CAPS, timeoutMs: KOPIA_RUN_TIMEOUT_MS },
      );
      const manifest = parseSnapshotManifest(created.stdout);

      job.phase = 'cleanup';

      return {
        id: run.backup,
        operation: 'backup',
        status: 'done',
        bytes: manifest.rootEntry.summ?.size ?? manifest.stats?.totalSize ?? 0,
        files: manifest.rootEntry.summ?.files ?? manifest.stats?.fileCount ?? 0,
        ...(typeof manifest.stats?.uploadedBytes === 'number' ? { uploadedBytes: manifest.stats.uploadedBytes } : {}),
        snapshot: {
          manifestId: manifest.id,
          rootObject: manifest.rootEntry.obj,
          startTime: new Date(manifest.startTime).toISOString(),
          endTime: new Date(manifest.endTime).toISOString(),
        },
        ...(run.hooks ? { hooks: true } : {}),
      };
    } finally {
      await cleanup.run(this.logger);
    }
  }

  /** The name of a VM disk in its snapshot: `<vm>.<disk>.raw`. */
  private static diskFile(volume: VolumeAssignment): string {
    return `${volume.id.split('/')[2]}.raw`;
  }

  /**
   * Backup of a VM disk (3.35, M7.3): the guest's file systems frozen through qemu-guest-agent while a running VM's
   * LV is snapshotted (else crash-consistent, tagged so), the snapshot opened read-only, an exact-size view of the
   * guest's disk (the LV minus DRBD's metadata at its end), streamed into Kopia as one file.
   */
  private async backupBlock(run: BackupRun, job: Job, volume: VolumeAssignment): Promise<BackupProgress> {
    const config = storageConfig();
    const name = jobName(run.backup);
    const cleanup = new Cleanup();

    try {
      const replica = vmReplicaOfVolume(volume.id);
      const launcher = replica && this.vms ? await this.vms.launcherOf(replica) : undefined;

      this.phase(run.backup, job, 'snapshot');

      const vms = this.vms;
      const frozen = await this.snapshotLv(
        volume,
        name,
        config,
        cleanup,
        launcher && vms ? { freeze: () => vms.freeze(launcher.Id), thaw: () => vms.thaw(launcher.Id) } : undefined,
      );

      const bytes = await this.volumes.blockSizeBytes(volume.id);
      const mapping = await this.openSnapshot(volume, name, config, cleanup);
      const view = `${name}${BLOCK_VIEW_SUFFIX}`;

      cleanup.add('disk view', () => this.commands.run('dmsetup', ['remove', view], { okExitCodes: [1] }));
      await this.commands.run('dmsetup', [
        'create',
        view,
        '--readonly',
        '--table',
        `0 ${bytes / 512} linear ${mapping} 0`,
      ]);

      this.phase(run.backup, job, 'upload');

      const client = await this.client(name, run.repository, cleanup);
      const created = await this.kopia(
        client,
        `${name}-snapshot`,
        [
          BLOCK_BACKUP_SCRIPT,
          'sh',
          `/dev/mapper/${view}`,
          `--stdin-file=${BackupService.diskFile(volume)}`,
          VOLUME_SNAPSHOT_PATH,
          '--json',
          '--parallel=4',
          `--description=${run.description}`,
          ...Object.entries(run.tags).map(([k, v]) => `--tags=${k}:${v}`),
          `--tags=consistency:${frozen ? 'filesystem-frozen' : 'crash'}`,
        ],
        {
          entrypoint: ['/bin/sh', '-c'],
          devices: [{ path: `/dev/mapper/${view}`, permissions: 'r' }],
          timeoutMs: KOPIA_RUN_TIMEOUT_MS,
        },
      );
      const manifest = parseSnapshotManifest(created.stdout);

      job.phase = 'cleanup';

      return {
        id: run.backup,
        operation: 'backup',
        status: 'done',
        bytes: manifest.rootEntry.summ?.size ?? manifest.stats?.totalSize ?? bytes,
        files: 1,
        ...(typeof manifest.stats?.uploadedBytes === 'number' ? { uploadedBytes: manifest.stats.uploadedBytes } : {}),
        snapshot: {
          manifestId: manifest.id,
          rootObject: manifest.rootEntry.obj,
          startTime: new Date(manifest.startTime).toISOString(),
          endTime: new Date(manifest.endTime).toISOString(),
        },
        // The guest agent froze the file systems: an application-level hook in effect.
        ...(frozen ? { hooks: true } : {}),
      };
    } finally {
      await cleanup.run(this.logger);
    }
  }

  /** The replica's container for hooks: it must run here, through Docker (not as a restored runc process). */
  private async hookContainer(replica: string): Promise<string> {
    const container = await this.workloads.containerOf(replica);

    if (!container || container.State !== 'running') throw new Error(`hook replica ${replica} doesn't run here`);

    if (container.Labels?.[RESTORED_LABEL])
      throw new Error(`hook replica ${replica} runs restored after a live migration; hooks need its next restart`);

    return container.Id;
  }

  private async hook(container: string, which: 'pre' | 'post', command: string[], timeoutSeconds: number) {
    const result = await this.runner.exec(container, command, timeoutSeconds * 1000);

    if (result.exitCode === null) throw new Error(`${which} hook timed out after ${timeoutSeconds} s`);

    if (result.exitCode !== 0)
      throw new Error(`${which} hook failed (exit ${result.exitCode}): ${lastLines(result.combined)}`);
  }

  /**
   * LVM thin snapshot of the volume's LV (LUKS → DRBD on top, internal metadata at its end). A file system mounted
   * here is frozen around it, so the snapshot holds a clean file system (journal flushed).
   */
  private async snapshotLv(
    volume: VolumeAssignment,
    name: string,
    config: StorageConfig,
    cleanup: Cleanup,
    guest?: { freeze: () => Promise<boolean>; thaw: () => Promise<void> },
  ): Promise<boolean> {
    const mounted = await this.volumes.mountedPath(volume.id, config);

    cleanup.add('snapshot LV', () =>
      this.commands.run('lvremove', ['-y', `${config.volumeGroup}/${name}`], { okExitCodes: [5] }),
    );

    if (mounted) await this.commands.run('fsfreeze', ['-f', mounted], { timeoutMs: 60_000 });

    // A VM disk: the guest's own file systems, frozen through its guest agent (false: crash-consistent).
    const frozen = guest ? await guest.freeze() : false;

    try {
      await this.commands.run('lvcreate', [
        '-q',
        '-s',
        '-kn',
        '-n',
        name,
        `${config.volumeGroup}/${drbdResourceName(volume)}`,
      ]);
    } finally {
      if (mounted) await this.commands.run('fsfreeze', ['-u', mounted], { okExitCodes: [1] });

      if (frozen)
        await guest
          ?.thaw()
          .catch((error: unknown) => this.logger.warn(`Thawing the guest of ${volume.id} failed: ${messageOf(error)}`));
    }

    await this.commands.run('lvchange', ['-ay', '-K', `${config.volumeGroup}/${name}`]);

    return frozen;
  }

  /**
   * Opens the snapshot read-only with the volume key (`volumeKey` over the volume's secret, the same on every
   * replica): the key goes to cryptsetup through a file on tmpfs, readable by root only, zeroed and removed right
   * after; no key slot (PBKDF) is involved.
   */
  private async openSnapshot(
    volume: VolumeAssignment,
    name: string,
    config: StorageConfig,
    cleanup: Cleanup,
  ): Promise<string> {
    const mapping = `${name}-crypt`;
    const material = await this.secrets.fetch(`volume:${volume.id}`, volume.keyRef);
    const key = volumeKey(material, volume.id);

    material.fill(0);

    try {
      await mkdir(config.keyTmpfs, { recursive: true, mode: 0o700 });
      await this.volumes.assertMemoryFs(config.keyTmpfs);

      const dir = await mkdtemp(join(config.keyTmpfs, `${name}-`));
      const keyFile = join(dir, 'volume.key');

      try {
        await writeFile(keyFile, key, { mode: 0o600, flag: 'wx' });
        cleanup.add('read-only mapping', () =>
          this.commands.run('cryptsetup', ['close', mapping], { okExitCodes: [4], timeoutMs: CRYPTSETUP_TIMEOUT_MS }),
        );
        await this.commands.run(
          'cryptsetup',
          [
            'open',
            '--readonly',
            '--type',
            'luks2',
            await this.volumes.volumeKeyFileOption(),
            keyFile,
            `/dev/${config.volumeGroup}/${name}`,
            mapping,
          ],
          { timeoutMs: CRYPTSETUP_TIMEOUT_MS },
        );
      } finally {
        await writeFile(keyFile, Buffer.alloc(key.length)).catch(() => undefined);
        await rm(dir, { recursive: true, force: true });
      }
    } finally {
      key.fill(0);
    }

    return `/dev/mapper/${mapping}`;
  }

  /** Read-only mount without journal replay (the device is read-only): ext4 `noload`, XFS `norecovery,nouuid`. */
  private async mountReadOnly(device: string, name: string, cleanup: Cleanup): Promise<string> {
    // Only file systems: the LV also carries DRBD's internal metadata at its end, which blkid reports as `drbd`.
    const probe = await this.commands.run('blkid', ['-p', '-u', 'filesystem', '-o', 'value', '-s', 'TYPE', device], {
      okExitCodes: [2],
    });
    const type = probe.stdout.trim();

    if (!type) throw new Error('the volume has no file system yet');

    const options = type === 'xfs' ? 'ro,norecovery,nouuid' : type === 'ext4' || type === 'ext3' ? 'ro,noload' : 'ro';

    return await this.mountAt(device, name, type, `${options},nodev,nosuid,noexec`, cleanup);
  }

  /** The type is always given: mount's own probing sees DRBD's metadata signature and reports `drbd`. */
  private async mountAt(
    device: string,
    name: string,
    type: string,
    options: string,
    cleanup: Cleanup,
  ): Promise<string> {
    const mountpoint = join(this.paths().mounts, name);

    await mkdir(mountpoint, { recursive: true, mode: 0o700 });
    cleanup.add('mount point', () => rm(mountpoint, { recursive: true, force: true }));
    cleanup.add('mount', () => this.commands.run('umount', [mountpoint], { okExitCodes: [32] }));
    await this.commands.run('mount', ['-t', type, '-o', options, device, mountpoint]);

    return mountpoint;
  }

  // Kopia client.

  /**
   * A Kopia client for one job: its own config / cache / log directory, connected to the first reachable
   * repository server as the given user, with the server certificate pinned by fingerprint. The password goes into
   * the environment of every invocation (the image doesn't persist credentials).
   */
  private async client(
    name: string,
    repository: KopiaRepositoryAccess,
    cleanup: Cleanup,
  ): Promise<{ dir: string; password: string }> {
    const dir = join(this.paths().work, name);

    await mkdir(dir, { recursive: true, mode: 0o700 });
    cleanup.add('client state', () => rm(dir, { recursive: true, force: true }));

    const client = { dir, password: repository.password };
    const errors: string[] = [];

    for (const server of repository.servers) {
      const host = server.address.includes(':') ? `[${server.address}]` : server.address;

      try {
        await this.kopia(
          client,
          `${name}-connect`,
          [
            'repository',
            'connect',
            'server',
            `--url=https://${host}:${server.port}`,
            `--server-cert-fingerprint=${repository.fingerprint}`,
            `--override-username=${repository.username}`,
            `--override-hostname=${repository.hostname}`,
          ],
          { timeoutMs: KOPIA_CONNECT_TIMEOUT_MS },
        );

        return client;
      } catch (error) {
        errors.push(`${host}:${server.port}: ${messageOf(error)}`);
      }
    }

    throw new Error(`no repository server reachable: ${errors.join('; ')}`.slice(0, 2000));
  }

  private async kopia(
    client: { dir: string; password: string },
    container: string,
    args: string[],
    options: {
      binds?: string[];
      caps?: string[];
      timeoutMs: number;
      entrypoint?: string[];
      devices?: { path: string; permissions: 'r' | 'rw' }[];
    },
  ): Promise<JobOutput> {
    const result = await this.runner.run({
      name: container,
      image: kopiaImage(),
      ...(options.entrypoint ? { entrypoint: options.entrypoint } : {}),
      cmd: args,
      env: {
        KOPIA_PASSWORD: client.password,
        KOPIA_CHECK_FOR_UPDATES: 'false',
        GOMEMLIMIT: kopiaGoMemoryLimit(KOPIA_MEMORY_BYTES),
      },
      binds: [`${client.dir}:/app`, ...(options.binds ?? [])],
      ...(options.devices ? { devices: options.devices } : {}),
      network: 'host',
      capAdd: options.caps ?? [],
      memoryBytes: KOPIA_MEMORY_BYTES,
      timeoutMs: options.timeoutMs,
    });

    if (result.exitCode === 0) return result;

    const error = new Error(
      result.exitCode === null
        ? `kopia ${args[0]} ${args[1] ?? ''} timed out`
        : `kopia ${args[0]} ${args[1] ?? ''} failed (exit ${result.exitCode}): ${lastLines(result.stderr || result.combined)}`,
    ) as Error & { exitCode?: number | null };

    error.exitCode = result.exitCode;
    throw error;
  }

  // Restore.

  private async restore(run: RestoreRun, job: Job): Promise<BackupProgress> {
    const cleanup = new Cleanup();
    const done: BackupProgress = { id: run.restore, operation: 'restore', status: 'done' };

    try {
      const block = run.kind !== 'scratch' && this.volumes.assignment(run.volume)?.mode === 'block';

      if (block && run.kind === 'path')
        throw new Error('VM disks are restored whole; single paths need the disk mounted in a VM');

      switch (run.kind) {
        case 'volume':
          if (block) await this.restoreBlock(run, job, cleanup);
          else await this.restoreVolume(run, job, cleanup);

          return done;
        case 'path':
          await this.restorePath(run, job, cleanup);

          return done;
        case 'scratch':
          return await this.restoreScratch(run, job, cleanup);
      }
    } finally {
      await cleanup.run(this.logger);
    }
  }

  /**
   * Whole snapshot into the volume (its primary is here). Containers using the volume are stopped first (their
   * replicas protected from the reconcile meanwhile) and started again afterwards, also on failure. `replace`
   * deletes what the snapshot doesn't contain; `merge` only adds / overwrites.
   */
  private async restoreVolume(run: RestoreRun, job: Job, cleanup: Cleanup): Promise<void> {
    const volume = this.primaryVolume(run.volume);
    const name = jobName(run.restore);

    this.phase(run.restore, job, 'restore');

    const client = await this.client(name, run.repository, cleanup);
    const users = await this.runner.usersOf(volume.dockerName);
    const replicas = users.map((c) => c.Labels?.[WORKLOAD_LABEL]).filter((r): r is string => !!r);

    for (const replica of replicas) this.sessions?.begin(replica);

    cleanup.add('protected replicas', async () => {
      for (const replica of replicas) this.sessions?.end(replica);
    });
    cleanup.add('restart containers', async () => {
      const failures: string[] = [];

      for (const c of users)
        await this.runner.start(c.Id).catch((error: unknown) => failures.push(`${c.Id}: ${messageOf(error)}`));

      if (failures.length) throw new Error(`containers not started again: ${failures.join('; ')}`);
    });

    for (const c of users) await this.runner.stop(c.Id);

    const mountpoint = await this.volumeMount(volume, cleanup);

    await this.kopia(
      client,
      `${name}-restore`,
      [
        'snapshot',
        'restore',
        run.snapshot,
        VOLUME_SNAPSHOT_PATH,
        ...OVERWRITE,
        ...(run.mode === 'merge' ? [] : ['--delete-extra']),
      ],
      { binds: [`${mountpoint}:${VOLUME_SNAPSHOT_PATH}`], caps: RESTORE_CAPS, timeoutMs: KOPIA_RUN_TIMEOUT_MS },
    );
  }

  /**
   * Whole VM disk from a snapshot (3.35): the VM's launcher stopped (its replica protected from the reconcile) and
   * started again afterwards, the disk file written onto the promoted DRBD device (the peers follow through DRBD).
   * A disk that isn't in use stays secondary afterwards.
   */
  private async restoreBlock(run: RestoreRun, job: Job, cleanup: Cleanup): Promise<void> {
    const volume = this.primaryVolume(run.volume);
    const name = jobName(run.restore);
    const replica = vmReplicaOfVolume(volume.id);
    const launcher = replica && this.vms ? await this.vms.launcherOf(replica) : undefined;

    this.phase(run.restore, job, 'restore');

    const client = await this.client(name, run.repository, cleanup);

    if (launcher && replica) {
      // Afterwards the reconcile decides (G5): restarting the launcher by id failed when it had been removed meanwhile
      // (a stop racing the restore), left a VM that should run absent until the next desired state, and would start
      // one the control plane had stopped. Cleanups run in reverse: protection ends first, then the re-apply.
      cleanup.add('reconcile the VM', () => this.workloads.reapply());
      this.sessions?.begin(replica);
      cleanup.add('protected replica', async () => this.sessions?.end(replica));
      await this.runner.stop(launcher.Id);
    } else {
      cleanup.add('demote the disk', () => this.volumes.demoteBlock(volume.id));
    }

    const { device } = await this.volumes.promoteBlock(volume.id);

    await this.kopia(
      client,
      `${name}-restore`,
      [BLOCK_RESTORE_SCRIPT, 'sh', `${run.snapshot}/${BackupService.diskFile(volume)}`, device],
      {
        entrypoint: ['/bin/sh', '-c'],
        devices: [{ path: device, permissions: 'rw' }],
        timeoutMs: KOPIA_RUN_TIMEOUT_MS,
      },
    );
  }

  /** The volume's mount point: as mounted for its workloads, or mounted for the job (and unmounted afterwards). */
  private async volumeMount(volume: VolumeAssignment, cleanup: Cleanup): Promise<string> {
    const mounted = await this.volumes.mountedPath(volume.id);

    if (mounted) return mounted;

    cleanup.add('volume mount', () => this.volumes.unmount(volume.dockerName));

    return await this.volumes.mount(volume.dockerName);
  }

  /** One file or directory into the (running) volume; refuses to overwrite unless asked. Nothing is stopped. */
  private async restorePath(run: RestoreRun, job: Job, cleanup: Cleanup): Promise<void> {
    const volume = this.primaryVolume(run.volume);
    const name = jobName(run.restore);
    const path = run.path as string;
    const target = run.targetPath ?? path;

    this.phase(run.restore, job, 'restore');

    const client = await this.client(name, run.repository, cleanup);
    const mountpoint = await this.volumeMount(volume, cleanup);

    try {
      await this.kopia(
        client,
        `${name}-restore`,
        [
          PATH_RESTORE_SCRIPT,
          'sh',
          target,
          `${run.snapshot}/${path}`,
          run.overwrite ? '1' : '0',
          ...(run.overwrite ? OVERWRITE : NO_OVERWRITE),
        ],
        {
          entrypoint: ['/bin/sh', '-c'],
          binds: [`${mountpoint}:${VOLUME_SNAPSHOT_PATH}`],
          caps: RESTORE_CAPS,
          timeoutMs: KOPIA_RUN_TIMEOUT_MS,
        },
      );
    } catch (error) {
      if ((error as { exitCode?: number }).exitCode === TARGET_EXISTS)
        throw new Error(`${target} exists in the volume; restore with overwrite to replace it`);

      throw error;
    }
  }

  /**
   * Restore test: a temporary thin LV of `sizeBytes` in the same pool, LUKS with a random throw-away key, a fresh
   * ext4, the snapshot restored into it, then the optional check container with the scratch volume at its mount
   * path (exit code + last 8 KiB of output reported; exit ≠ 0 fails the test). Everything is removed afterwards.
   */
  private async restoreScratch(run: RestoreRun, job: Job, cleanup: Cleanup): Promise<BackupProgress> {
    const config = storageConfig();
    const name = jobName(run.restore);
    const lv = `/dev/${config.volumeGroup}/${name}`;
    const mapping = `${name}-crypt`;

    this.phase(run.restore, job, 'restore');

    const client = await this.client(name, run.repository, cleanup);

    cleanup.add('scratch LV', () =>
      this.commands.run('lvremove', ['-y', `${config.volumeGroup}/${name}`], { okExitCodes: [5] }),
    );
    await this.commands.run('lvcreate', [
      '-q',
      '-y',
      '-V',
      `${run.sizeBytes}b`,
      '-T',
      `${config.volumeGroup}/${config.thinPool}`,
      '-n',
      name,
    ]);

    const key = randomBytes(64);

    try {
      await this.commands.run(
        'cryptsetup',
        ['luksFormat', '--type', 'luks2', '-q', ...LUKS_FORMAT, '--key-file', '-', lv],
        {
          input: key,
          timeoutMs: CRYPTSETUP_TIMEOUT_MS,
        },
      );
      cleanup.add('scratch mapping', () =>
        this.commands.run('cryptsetup', ['close', mapping], { okExitCodes: [4], timeoutMs: CRYPTSETUP_TIMEOUT_MS }),
      );
      await this.commands.run('cryptsetup', ['open', '--type', 'luks2', '--key-file', '-', lv, mapping], {
        input: key,
        timeoutMs: CRYPTSETUP_TIMEOUT_MS,
      });
    } finally {
      key.fill(0);
    }

    await this.commands.run('mkfs.ext4', ['-q', '-L', name, `/dev/mapper/${mapping}`], { timeoutMs: 300_000 });

    const mountpoint = await this.mountAt(`/dev/mapper/${mapping}`, name, 'ext4', 'nodev,nosuid', cleanup);

    await this.kopia(
      client,
      `${name}-restore`,
      ['snapshot', 'restore', run.snapshot, VOLUME_SNAPSHOT_PATH, ...OVERWRITE],
      { binds: [`${mountpoint}:${VOLUME_SNAPSHOT_PATH}`], caps: RESTORE_CAPS, timeoutMs: KOPIA_RUN_TIMEOUT_MS },
    );

    if (!run.check) return { id: run.restore, operation: 'restore', status: 'done' };

    this.phase(run.restore, job, 'check');

    const applied = await this.state.appliedState().catch(() => null);
    const result = await this.runner.run({
      name: `${name}-check`,
      image: routedImage(run.check.image, applied?.registryClient),
      entrypoint: [run.check.command[0]],
      cmd: run.check.command.slice(1),
      binds: [`${mountpoint}:${run.check.mountPath}`],
      network: 'none',
      capAdd: RESTORE_CAPS,
      memoryBytes: CHECK_MEMORY_BYTES,
      timeoutMs: run.check.timeoutSeconds * 1000,
    });
    const check = { exitCode: result.exitCode, output: result.combined.slice(-CHECK_OUTPUT_BYTES) };

    if (result.exitCode === 0) return { id: run.restore, operation: 'restore', status: 'done', check };

    return {
      id: run.restore,
      operation: 'restore',
      status: 'failed',
      phase: 'check',
      check,
      error:
        result.exitCode === null
          ? `check timed out after ${run.check.timeoutSeconds} s`
          : `check failed (exit ${result.exitCode})`,
    };
  }
}
