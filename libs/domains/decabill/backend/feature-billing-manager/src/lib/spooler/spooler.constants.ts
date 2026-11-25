/**
 * Central spooler: admin-triggered printouts and document sends run as tracked background jobs (BullMQ) instead of
 * inside the console request. Each job has a kind (what to produce / send) and an output target (where it goes).
 */
export enum SpoolJobKind {
  /** Send an invoice, credit note or offer to the customer (email or letter). */
  DOCUMENT_SEND = 'document.send',
  /** Inventory labels / property stickers PDF. */
  INVENTORY_LABELS = 'print.inventory_labels',
  /** Inventory movement document (putaway, transfer, withdrawal, lending) PDF. */
  INVENTORY_MOVEMENT = 'print.inventory_movement',
  /** Project time report PDF for a period. */
  PROJECT_TIME_REPORT = 'print.project_time_report',
}

export const SPOOL_JOB_KINDS = Object.values(SpoolJobKind);

export enum SpoolJobStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export const SPOOL_JOB_STATUSES = Object.values(SpoolJobStatus);

/** Statuses that will not change anymore (retention applies). */
export const FINISHED_SPOOL_JOB_STATUSES: readonly SpoolJobStatus[] = [
  SpoolJobStatus.COMPLETED,
  SpoolJobStatus.FAILED,
  SpoolJobStatus.CANCELLED,
];

/**
 * Where a job's output goes: `download` (file kept for the console to download), `email` / `postal` (delivered to the
 * customer). Printers can be added as further targets.
 */
export enum SpoolOutputTarget {
  DOWNLOAD = 'download',
  EMAIL = 'email',
  POSTAL = 'postal',
}

/** Attempts per job (first run + retries with exponential backoff). */
export const SPOOL_JOB_MAX_ATTEMPTS = 3;

export const SPOOL_JOB_BACKOFF_MS = 10_000;

/** Largest output kept for download (labels for 1000 items stay far below). */
export const SPOOL_OUTPUT_MAX_BYTES = 50 * 1024 * 1024;

/** Error text stored on a job (shown to admins). */
export const SPOOL_ERROR_MAX_LENGTH = 500;

/** Default retention of finished jobs and their files (`BILLING_SPOOLER_RETENTION_DAYS`). */
export const SPOOL_RETENTION_DAYS_DEFAULT = 7;

/** Queued jobs older than this are re-enqueued by the coordinator (lost queue entries). */
export const SPOOL_STALE_QUEUED_MS = 2 * 60 * 1000;

/** Processing jobs older than this are re-enqueued (crashed worker); BullMQ's stall detection usually wins first. */
export const SPOOL_STALE_PROCESSING_MS = 15 * 60 * 1000;
