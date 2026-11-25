/** How a document reached the customer: emailed, posted as a letter (postal provider) or marked as sent manually. */
export type DocumentDeliveryChannel = 'email' | 'letter' | 'manual';

/** Customer profile: `letter` posts documents in addition to the email (only while letters are available). */
export type CustomerDeliveryPreference = 'email' | 'letter';

/** Channels a console send can use (manual = mark as sent). */
export type SpooledDeliveryChannel = 'email' | 'letter';

/** `POST …/mark-sent`: when the document was sent outside Decabill (ISO date / datetime; default now). */
export interface MarkDocumentSentDto {
  sentAt?: string;
}

export type SpoolJobKind =
  | 'document.send'
  | 'print.inventory_labels'
  | 'print.inventory_movement'
  | 'print.project_time_report';

export type SpoolJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type SpoolOutputTarget = 'download' | 'email' | 'postal';

/** One spooled printout or document send (Spooler page). */
export interface SpoolJob {
  id: string;
  kind: SpoolJobKind;
  status: SpoolJobStatus;
  outputTarget: SpoolOutputTarget;
  title: string;
  documentType: 'invoice' | 'credit_note' | 'offer' | null;
  documentId: string | null;
  attempts: number;
  error: string | null;
  hasFile: boolean;
  fileName: string | null;
  fileSize: number | null;
  externalLetterId: string | null;
  canRetry: boolean;
  canCancel: boolean;
  createdByUserId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PaginatedSpoolJobs {
  items: SpoolJob[];
  total: number;
  limit: number;
  offset: number;
  /** Jobs per status in the tenant. */
  counts: Partial<Record<SpoolJobStatus, number>>;
}

export interface SpoolJobListParams {
  status?: SpoolJobStatus;
  kind?: SpoolJobKind;
  documentType?: 'invoice' | 'credit_note' | 'offer';
  documentId?: string;
  limit?: number;
  offset?: number;
}

/** Postal delivery availability of the tenant (billing capabilities). */
export interface PostalDeliveryCapability {
  available: boolean;
  provider: string | null;
  providerName: string | null;
}
