import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { DELIVERABLE_DOCUMENT_TYPES } from '../constants/document-delivery.constants';

import type { SpoolJobEntity } from './entities/spool-job.entity';
import {
  SPOOL_JOB_KINDS,
  SPOOL_JOB_STATUSES,
  type SpoolJobKind,
  type SpoolJobStatus,
  type SpoolOutputTarget,
} from './spooler.constants';

/** `GET /admin/billing/spooler/jobs` filters. */
export class ListSpoolJobsQueryDto {
  @IsOptional()
  @IsIn(SPOOL_JOB_STATUSES)
  status?: SpoolJobStatus;

  @IsOptional()
  @IsIn(SPOOL_JOB_KINDS)
  kind?: SpoolJobKind;

  @IsOptional()
  @IsIn(DELIVERABLE_DOCUMENT_TYPES)
  documentType?: string;

  @IsOptional()
  @IsUUID('4')
  documentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export interface SpoolJobResponseDto {
  id: string;
  kind: SpoolJobKind;
  status: SpoolJobStatus;
  outputTarget: SpoolOutputTarget;
  title: string;
  documentType: string | null;
  documentId: string | null;
  attempts: number;
  error: string | null;
  /** A file is ready for download (completed download jobs). */
  hasFile: boolean;
  fileName: string | null;
  fileSize: number | null;
  /** Provider letter id of a document sent as a letter. */
  externalLetterId: string | null;
  canRetry: boolean;
  canCancel: boolean;
  createdByUserId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PaginatedSpoolJobsResponseDto {
  items: SpoolJobResponseDto[];
  total: number;
  limit: number;
  offset: number;
  /** Jobs per status in the current tenant. */
  counts: Record<string, number>;
}

/** Response of an action that spooled a document send (send by email / letter). */
export interface SpooledActionDto {
  spoolJob: SpoolJobResponseDto;
}

export function mapSpoolJob(job: SpoolJobEntity): SpoolJobResponseDto {
  const externalLetterId = job.payload?.['externalLetterId'];

  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    outputTarget: job.outputTarget,
    title: job.title,
    documentType: job.documentType ?? null,
    documentId: job.documentId ?? null,
    attempts: job.attempts,
    error: job.error ?? null,
    hasFile: job.status === 'completed' && Boolean(job.fileName),
    fileName: job.fileName ?? null,
    fileSize: job.fileSize ?? null,
    externalLetterId: typeof externalLetterId === 'string' ? externalLetterId : null,
    canRetry: job.status === 'failed',
    canCancel: job.status === 'queued',
    createdByUserId: job.createdByUserId ?? null,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  };
}
