import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';

import { BillingAuditLogService } from '../services/billing-audit-log.service';
import { getRequiredTenantId } from '../utils/tenant-query.utils';

import type { SpoolJobEntity } from './entities/spool-job.entity';
import { SpoolJobsRepository, type SpoolJobListFilter } from './spool-jobs.repository';
import { SpoolPermanentError, type SpoolKindHandler } from './spool-kind-handler.interface';
import { SPOOLER_ENQUEUE, type SpoolerEnqueuePort } from './spooler-enqueue.token';
import {
  FINISHED_SPOOL_JOB_STATUSES,
  SPOOL_ERROR_MAX_LENGTH,
  SPOOL_JOB_MAX_ATTEMPTS,
  SPOOL_OUTPUT_MAX_BYTES,
  SPOOL_RETENTION_DAYS_DEFAULT,
  SPOOL_STALE_PROCESSING_MS,
  SPOOL_STALE_QUEUED_MS,
  type SpoolJobKind,
  SpoolJobStatus,
  type SpoolOutputTarget,
} from './spooler.constants';

export interface CreateSpoolJobParams {
  kind: SpoolJobKind;
  outputTarget: SpoolOutputTarget;
  title: string;
  payload: Record<string, unknown>;
  documentType?: string | null;
  documentId?: string | null;
  createdByUserId?: string | null;
}

/** Attempt information of the BullMQ job running a spool job. */
export interface SpoolAttemptInfo {
  /** Attempts BullMQ already made before this one. */
  attemptsMade: number;
  maxAttempts: number;
}

const COORDINATOR_BATCH = 200;

/**
 * Central spooler. Console touchpoints create a job (validated, claimed where needed) and return right away; the
 * BullMQ worker runs the kind handler inside the job's tenant. Finished jobs and their files are removed after
 * `BILLING_SPOOLER_RETENTION_DAYS`.
 */
@Injectable()
export class SpoolerService {
  private readonly logger = new Logger(SpoolerService.name);
  private readonly handlers = new Map<SpoolJobKind, SpoolKindHandler>();

  constructor(
    private readonly repository: SpoolJobsRepository,
    private readonly auditLog: BillingAuditLogService,
    @Optional() @Inject(SPOOLER_ENQUEUE) private readonly enqueuePort?: SpoolerEnqueuePort,
  ) {}

  registerHandler(handler: SpoolKindHandler): void {
    this.handlers.set(handler.kind, handler);
  }

  /** Creates a job in the current tenant and hands it to the queue (a lost hand-over is repaired by the coordinator). */
  async create(params: CreateSpoolJobParams): Promise<SpoolJobEntity> {
    if (!this.handlers.has(params.kind)) {
      throw new BadRequestException(`Spool job kind ${params.kind} is not available`);
    }

    const job = await this.repository.create({
      kind: params.kind,
      status: SpoolJobStatus.QUEUED,
      outputTarget: params.outputTarget,
      title: params.title.slice(0, 255),
      payload: params.payload,
      documentType: params.documentType ?? null,
      documentId: params.documentId ?? null,
      createdByUserId: params.createdByUserId ?? null,
      attempts: 0,
    });

    await this.enqueue(job);

    return job;
  }

  async list(filter: SpoolJobListFilter): Promise<{ items: SpoolJobEntity[]; total: number }> {
    return await this.repository.list(filter);
  }

  async get(id: string): Promise<SpoolJobEntity> {
    return await this.repository.findByIdOrThrow(id);
  }

  async countByStatus(): Promise<Record<string, number>> {
    return await this.repository.countByStatus();
  }

  /** Output file of a completed job of the current tenant. */
  async getOutput(id: string): Promise<{ content: Buffer; fileName: string; contentType: string }> {
    const job = await this.repository.findByIdOrThrow(id);

    if (job.status !== SpoolJobStatus.COMPLETED || !job.fileName) {
      throw new NotFoundException('This spool job has no file');
    }

    const content = await this.repository.readOutput(id);

    if (!content) {
      throw new NotFoundException('The file of this spool job is no longer available');
    }

    return { content, fileName: job.fileName, contentType: job.contentType ?? 'application/octet-stream' };
  }

  /** Cancels a job that has not started yet (sends release their document claim). */
  async cancel(id: string, adminUserId?: string): Promise<SpoolJobEntity> {
    const job = await this.repository.findByIdOrThrow(id);

    if (!(await this.repository.cancelQueued(id))) {
      throw new BadRequestException('Only queued spool jobs can be cancelled');
    }

    await this.handlers.get(job.kind)?.onAbandoned?.(job, 'cancelled');
    await this.audit(job, 'spool_job.cancel', 'info', `Cancelled spool job: ${job.title}`, { adminUserId });

    return await this.repository.findByIdOrThrow(id);
  }

  /** Queues a failed job again with a fresh attempt budget. */
  async retry(id: string, adminUserId?: string): Promise<SpoolJobEntity> {
    const job = await this.repository.findByIdOrThrow(id);

    if (job.status !== SpoolJobStatus.FAILED) {
      throw new BadRequestException('Only failed spool jobs can be retried');
    }

    const handler = this.handlers.get(job.kind);
    const payload = handler?.prepareRetry ? await handler.prepareRetry(job) : job.payload;

    if (!(await this.repository.requeueFailed(id, payload))) {
      throw new BadRequestException('Only failed spool jobs can be retried');
    }

    await this.audit(job, 'spool_job.retry', 'info', `Retried spool job: ${job.title}`, { adminUserId });

    const requeued = await this.repository.findByIdOrThrow(id);

    await this.enqueue(requeued);

    return requeued;
  }

  /**
   * Worker entry (inside the job's tenant). Resolves normally when the job is done, failed for good or no longer
   * pending; throws to let BullMQ retry.
   */
  async process(spoolJobId: string, attempt: SpoolAttemptInfo): Promise<void> {
    const pending = await this.repository.findById(spoolJobId);

    if (!pending || pending.tenantId !== getRequiredTenantId()) {
      this.logger.warn(`Spool job ${spoolJobId} not found in the job's tenant; skipping`);

      return;
    }

    const job = await this.repository.startProcessing(spoolJobId);

    if (!job) {
      return;
    }

    const handler = this.handlers.get(job.kind);

    if (!handler) {
      await this.fail(job, `No handler for spool job kind ${job.kind}`, true);

      return;
    }

    try {
      const result = await handler.run(job);
      const output = result.output ?? null;

      if (output && output.content.length > SPOOL_OUTPUT_MAX_BYTES) {
        throw new SpoolPermanentError('The generated file is too large to keep');
      }

      await this.repository.complete(
        job.id,
        output,
        result.payload ? { payload: { ...job.payload, ...result.payload } } : {},
      );
      await this.audit(job, 'spool_job.complete', 'info', `Completed spool job: ${job.title}`, {
        attempts: job.attempts,
      });
    } catch (error) {
      const message = describeError(error);
      const permanent = isPermanent(error);
      const final = permanent || attempt.attemptsMade + 1 >= Math.min(attempt.maxAttempts, SPOOL_JOB_MAX_ATTEMPTS);

      await this.fail(job, message, final);

      if (!final) {
        throw error;
      }
    }
  }

  /**
   * Repairs lost queue hand-overs (queued / stuck jobs are enqueued again; the queue de-duplicates by job id) and
   * removes finished jobs past the retention period. Runs across tenants.
   */
  async coordinate(now: Date = new Date()): Promise<{ requeued: number; purged: number }> {
    const stale = await this.repository.findStale(
      new Date(now.getTime() - SPOOL_STALE_QUEUED_MS),
      new Date(now.getTime() - SPOOL_STALE_PROCESSING_MS),
      COORDINATOR_BATCH,
    );

    for (const job of stale) {
      await this.repository.touch(job.id);
      await this.enqueue(job);
    }

    const retentionDays = resolveRetentionDays();
    const purged = await this.repository.purgeFinishedBefore(
      new Date(now.getTime() - retentionDays * 86_400_000),
      FINISHED_SPOOL_JOB_STATUSES,
    );

    if (stale.length > 0 || purged > 0) {
      this.logger.log(`Spooler: re-enqueued ${stale.length} job(s), purged ${purged} finished job(s)`);
    }

    return { requeued: stale.length, purged };
  }

  private async fail(job: SpoolJobEntity, message: string, final: boolean): Promise<void> {
    const error = message.slice(0, SPOOL_ERROR_MAX_LENGTH);

    if (!(await this.repository.recordFailure(job.id, error, final))) {
      return;
    }

    if (!final) {
      this.logger.warn(`Spool job ${job.id} (${job.kind}) attempt ${job.attempts} failed, retrying: ${error}`);

      return;
    }

    try {
      await this.handlers.get(job.kind)?.onAbandoned?.(job, 'failed');
    } catch (abandonError) {
      this.logger.error(`Spool job ${job.id}: cleanup after failure failed: ${describeError(abandonError)}`);
    }

    await this.audit(job, 'spool_job.fail', 'error', `Spool job failed: ${job.title}`, {
      error,
      attempts: job.attempts,
    });
  }

  private async enqueue(job: SpoolJobEntity): Promise<void> {
    if (!this.enqueuePort) {
      this.logger.warn(`No spooler queue available; job ${job.id} stays queued`);

      return;
    }

    try {
      await this.enqueuePort.enqueueUnit({ spoolJobId: job.id, tenantId: job.tenantId });
    } catch (error) {
      // The job stays queued; the coordinator enqueues it again.
      this.logger.warn(`Failed to enqueue spool job ${job.id}: ${describeError(error)}`);
    }
  }

  private async audit(
    job: SpoolJobEntity,
    process: string,
    level: 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    const documentRef =
      job.documentType === 'offer'
        ? { offerId: job.documentId ?? undefined }
        : job.documentId
          ? { invoiceId: job.documentId }
          : {};

    await this.auditLog.log({
      process,
      level,
      message,
      ...documentRef,
      context: { spoolJobId: job.id, kind: job.kind, ...context },
    });
  }
}

function resolveRetentionDays(): number {
  const parsed = Number.parseInt(process.env.BILLING_SPOOLER_RETENTION_DAYS ?? '', 10);

  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 365 ? parsed : SPOOL_RETENTION_DAYS_DEFAULT;
}

function isPermanent(error: unknown): boolean {
  if (error instanceof SpoolPermanentError) {
    return true;
  }

  if (error instanceof HttpException) {
    const status = error.getStatus();

    return status >= 400 && status < 500 && status !== 408 && status !== 429;
  }

  return false;
}

function describeError(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const message =
      typeof response === 'object' && response && 'message' in response
        ? (response as { message: unknown }).message
        : error.message;

    return Array.isArray(message) ? message.join('; ') : String(message);
  }

  return error instanceof Error ? error.message : 'Unknown error';
}
