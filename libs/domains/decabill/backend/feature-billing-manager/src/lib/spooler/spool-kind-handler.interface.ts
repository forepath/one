import type { SpoolJobEntity } from './entities/spool-job.entity';
import type { SpoolJobKind } from './spooler.constants';

/** File produced by a printout job (download target). */
export interface SpoolOutputFile {
  content: Buffer;
  fileName: string;
  contentType: string;
}

export interface SpoolRunResult {
  output?: SpoolOutputFile | null;
  /** Payload changes to keep (e.g. the provider letter id), merged into the stored payload. */
  payload?: Record<string, unknown>;
}

/**
 * Executes one kind of spool job inside the job's tenant context. `run` may throw: `SpoolPermanentError` and 4xx
 * HTTP exceptions end the job right away, everything else is retried (up to `SPOOL_JOB_MAX_ATTEMPTS`).
 */
export interface SpoolKindHandler {
  readonly kind: SpoolJobKind;
  run(job: SpoolJobEntity): Promise<SpoolRunResult>;
  /** The job failed for good or was cancelled before it ran (sends release their document claim). */
  onAbandoned?(job: SpoolJobEntity, reason: 'failed' | 'cancelled'): Promise<void>;
  /**
   * Before a failed job is queued again; may refuse (throw) or return an updated payload (sends claim the document
   * again).
   */
  prepareRetry?(job: SpoolJobEntity): Promise<Record<string, unknown>>;
}

/** Errors that retrying cannot fix (missing data, document already sent …). */
export class SpoolPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpoolPermanentError';
  }
}
