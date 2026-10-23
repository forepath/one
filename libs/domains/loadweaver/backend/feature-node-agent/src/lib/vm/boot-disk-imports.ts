import type { VmImageRef, VmImportProgress, WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Logger } from '@nestjs/common';

import type { VolumeManager } from '../volumes/volume.manager';
import { WorkloadDeferred } from '../workloads/workload.manager';
import type { VmImageImporter, VmImportStep } from './vm-image-import';

/**
 * The first import of VM boot disks as background jobs (3.35, F3b): the reconcile only decides (`prepareBootDisk`
 * marks the disk `lw.importing`) and queues a job per disk, then moves on (the launcher is deferred,
 * `WorkloadDeferred`). At most `concurrency` imports run on the node at once, one per disk. A finished job lets the
 * workloads re-apply (the launcher starts on the written disk); a failed one is reported (workload status + event)
 * and retried with backoff; a job whose replica / disk left the node (VM deleted or stopped, placement moved, another
 * image pinned) is cancelled and its disk demoted. Restart-safe through W9's tags: an agent restart loses the jobs,
 * the disk still says `lw.importing`, so the next reconcile repeats the import; data a finished disk holds is never
 * overwritten (`lw.init` / adopt-on-failover unchanged).
 */

export type BootDiskImportPhase = 'queued' | 'fetching' | 'writing' | 'done' | 'failed' | 'cancelled';

export interface BootDiskImportJob {
  volume: string;
  replica: string;
  specHash: string;
  digest: string;
  phase: BootDiskImportPhase;
  bytes: number;
  totalBytes?: number;
  error?: string;
  /** Failed attempts in a row (backoff). */
  failures: number;
  /** Earliest next attempt after a failure (epoch ms). */
  retryAt?: number;
  readonly controller: AbortController;
  run: () => Promise<void>;
}

export interface BootDiskImportsOptions {
  /** Imports running at once on the node (`LOADWEAVER_VM_IMPORT_CONCURRENCY`, default 2). */
  concurrency?: number;
  /** First retry delay after a failure; doubles per failure up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
  now?: () => number;
}

export type BootDiskImportEvent = {
  level: 'info' | 'error';
  message: string;
  labels: Record<string, string>;
};

export const DEFAULT_VM_IMPORT_CONCURRENCY = 2;

export function vmImportConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env['LOADWEAVER_VM_IMPORT_CONCURRENCY']);

  return Number.isSafeInteger(value) && value > 0 && value <= 16 ? value : DEFAULT_VM_IMPORT_CONCURRENCY;
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1500);
}

/** Read through a function: a job's phase changes while its write is awaited (cancellation). */
const isCancelled = (job: BootDiskImportJob): boolean => job.phase === 'cancelled';

/** Phases a job holds its disk in (primary on this node, written or about to be). */
const ACTIVE: ReadonlySet<BootDiskImportPhase> = new Set(['queued', 'fetching', 'writing']);

export class BootDiskImports {
  private readonly logger = new Logger(BootDiskImports.name);
  private readonly jobs = new Map<string, BootDiskImportJob>();
  private readonly queue: string[] = [];
  private running = 0;
  private readonly listeners: (() => void)[] = [];
  private readonly concurrency: number;
  private readonly retryMs: number;
  private readonly maxRetryMs: number;
  private readonly now: () => number;

  constructor(
    private readonly importer: Pick<VmImageImporter, 'prepareBootDisk' | 'importBootDisk'>,
    private readonly volumes: Pick<VolumeManager, 'assignment' | 'demoteBlock'>,
    private readonly report: (event: BootDiskImportEvent) => void,
    options: BootDiskImportsOptions = {},
  ) {
    this.concurrency = options.concurrency ?? vmImportConcurrency();
    this.retryMs = options.retryMs ?? 60_000;
    this.maxRetryMs = options.maxRetryMs ?? 30 * 60_000;
    this.now = options.now ?? Date.now;
  }

  /** Called whenever a job settled (done or failed). */
  onSettled(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** The job of a disk (any phase). */
  job(volume: string): BootDiskImportJob | undefined {
    return this.jobs.get(volume);
  }

  /** Jobs to report in the workload status (active and failed ones). */
  reportable(): BootDiskImportJob[] {
    return [...this.jobs.values()];
  }

  /** Whether a replica's boot disk is held by an import (queued / fetching / writing). */
  holds(replica: string): boolean {
    return [...this.jobs.values()].some((j) => j.replica === replica && ACTIVE.has(j.phase));
  }

  /** Whether a disk is being imported (queued / fetching / writing). */
  active(volume: string): boolean {
    const job = this.jobs.get(volume);

    return !!job && ACTIVE.has(job.phase);
  }

  /** The workload status view of a job. */
  static progress(job: BootDiskImportJob): VmImportProgress {
    const phase: VmImportProgress['phase'] =
      job.phase === 'fetching' || job.phase === 'writing' || job.phase === 'failed' ? job.phase : 'queued';

    return {
      phase,
      ...(job.bytes ? { bytes: job.bytes } : {}),
      ...(job.totalBytes !== undefined ? { totalBytes: job.totalBytes } : {}),
    };
  }

  /**
   * The DRBD device of a VM's boot disk, promoted here, when it is ready to boot; otherwise its import is started /
   * observed in the background and `WorkloadDeferred` thrown (the reconcile goes on with other workloads).
   */
  async ensure(
    owner: { replica: string; specHash: string },
    volume: string,
    image: VmImageRef,
    launcherImage: string,
  ): Promise<string> {
    const existing = this.jobs.get(volume);
    let failures = 0;

    if (existing) {
      // A recreate (new spec hash) of the same VM keeps the running import.
      existing.replica = owner.replica;
      existing.specHash = owner.specHash;

      if (ACTIVE.has(existing.phase)) throw new WorkloadDeferred(`${owner.replica}: ${this.describe(existing)}`);

      if (existing.phase === 'failed') {
        if (this.now() < (existing.retryAt ?? 0))
          throw new WorkloadDeferred(`${owner.replica}: boot disk import failed: ${existing.error ?? 'unknown'}`);

        failures = existing.failures;
      }

      this.jobs.delete(volume);
    }

    const prepared = await this.importer.prepareBootDisk(volume);

    if (!prepared.import) return prepared.device;

    const layer = { ref: image.ref, ...prepared.import };
    const controller = new AbortController();
    const job: BootDiskImportJob = {
      volume,
      replica: owner.replica,
      specHash: owner.specHash,
      digest: layer.digest,
      phase: 'queued',
      bytes: 0,
      failures,
      controller,
      run: async () => {
        await this.importer.importBootDisk(volume, prepared.device, layer, launcherImage, {
          signal: controller.signal,
          progress: (step: VmImportStep) => {
            if (!ACTIVE.has(job.phase)) return;

            job.phase = step.phase;
            job.bytes = step.bytes;

            if (step.totalBytes !== undefined) job.totalBytes = step.totalBytes;
            else delete job.totalBytes;
          },
        });
      },
    };

    this.jobs.set(volume, job);
    this.queue.push(volume);
    this.report({
      level: 'info',
      message: `writing boot disk ${volume} of ${owner.replica} from ${image.ref}`,
      labels: { replica: owner.replica, volume, operation: 'boot-disk-import', result: 'running' },
    });
    this.pump();

    throw new WorkloadDeferred(`${owner.replica}: ${this.describe(job)}`);
  }

  /**
   * The desired workloads of an apply: jobs whose replica no longer wants this disk as its boot disk here (VM deleted
   * or stopped, placement moved), whose volume is gone, or whose volume now initializes from another image are
   * cancelled; their disk is demoted once the write stopped.
   */
  desired(workloads: readonly WorkloadSpec[]): void {
    const wanted = new Set<string>();

    for (const spec of workloads)
      for (const disk of spec.vm?.disks ?? []) if (disk.boot) wanted.add(`${spec.id}\n${disk.volume}`);

    for (const job of [...this.jobs.values()]) {
      const assignment = this.volumes.assignment(job.volume);
      const reason = !wanted.has(`${job.replica}\n${job.volume}`)
        ? `${job.replica} no longer runs here`
        : !assignment
          ? `volume ${job.volume} left this node`
          : assignment.initializeFrom?.digest !== job.digest
            ? `volume ${job.volume} now initializes from ${assignment.initializeFrom?.digest ?? 'nothing'}`
            : null;

      if (reason) this.cancel(job, reason);
    }
  }

  /** Stops a job (queued: dropped; running: aborted, its container killed); the disk is demoted afterwards. */
  private cancel(job: BootDiskImportJob, reason: string): void {
    this.jobs.delete(job.volume);

    const queued = this.queue.indexOf(job.volume);

    if (queued >= 0) this.queue.splice(queued, 1);

    const wasActive = ACTIVE.has(job.phase);
    const writing = job.phase === 'fetching' || job.phase === 'writing';

    job.phase = 'cancelled';

    if (wasActive) {
      this.logger.log(`Boot disk import of ${job.volume} cancelled: ${reason}`);
      this.report({
        level: 'info',
        message: `boot disk import of ${job.volume} cancelled: ${reason}`,
        labels: { replica: job.replica, volume: job.volume, operation: 'boot-disk-import', result: 'cancelled' },
      });
      job.controller.abort(new Error(`cancelled: ${reason}`));
    }

    // A running write demotes once it stopped (in `start`); queued / failed jobs hold the disk without a writer.
    if (!writing) void this.demote(job.volume);
  }

  private async demote(volume: string): Promise<void> {
    if (!this.volumes.assignment(volume) || this.jobs.has(volume)) return;

    await this.volumes
      .demoteBlock(volume)
      .catch((error: unknown) => this.logger.warn(`Demoting VM disk ${volume}: ${messageOf(error)}`));
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length) {
      const volume = this.queue.shift() as string;
      const job = this.jobs.get(volume);

      if (job?.phase === 'queued') void this.start(job);
    }
  }

  private async start(job: BootDiskImportJob): Promise<void> {
    this.running++;
    job.phase = 'fetching';

    try {
      await job.run();

      if (isCancelled(job)) return;

      job.phase = 'done';
      // The disk says `lw.init` now: the next `ensure` hands out the device.
      this.jobs.delete(job.volume);
      this.logger.log(`Boot disk ${job.volume} of ${job.replica} written from ${job.digest}`);
      this.report({
        level: 'info',
        message: `boot disk ${job.volume} of ${job.replica} written from its image`,
        labels: { replica: job.replica, volume: job.volume, operation: 'boot-disk-import', result: 'done' },
      });
    } catch (error) {
      if (isCancelled(job)) return;

      job.phase = 'failed';
      job.error = messageOf(error);
      job.failures++;
      job.retryAt = this.now() + Math.min(this.maxRetryMs, this.retryMs * 2 ** (job.failures - 1));
      this.logger.warn(`Boot disk import of ${job.volume} failed: ${job.error}`);
      this.report({
        level: 'error',
        message: `boot disk import of ${job.volume} failed: ${job.error}`,
        labels: { replica: job.replica, volume: job.volume, operation: 'boot-disk-import', result: 'failed' },
      });
    } finally {
      this.running--;

      if (isCancelled(job)) void this.demote(job.volume);
      else this.settled();

      this.pump();
    }
  }

  private settled(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // a listener's problem
      }
    }
  }

  /** The status message of a job. */
  describe(job: BootDiskImportJob): string {
    const mib = (bytes: number) => `${Math.floor(bytes / 1024 ** 2)} MiB`;

    switch (job.phase) {
      case 'queued':
        return 'boot disk import queued (other imports are running on this node)';
      case 'fetching':
        return `fetching the VM image for the boot disk (${mib(job.bytes)})`;
      case 'writing':
        return job.totalBytes
          ? `writing the boot disk from the VM image (${mib(job.bytes)} of ${mib(job.totalBytes)})`
          : 'writing the boot disk from the VM image';
      case 'failed':
        return `boot disk import failed: ${job.error ?? 'unknown'}`;
      default:
        return `boot disk import ${job.phase}`;
    }
  }
}
