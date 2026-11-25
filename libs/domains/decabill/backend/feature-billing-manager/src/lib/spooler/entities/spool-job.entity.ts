import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { SpoolJobKind, SpoolJobStatus, SpoolOutputTarget } from '../spooler.constants';

/** One spooled printout or send (see `SpoolJobKind`). Tenant-scoped; the output file lives in `SpoolJobOutputEntity`. */
@Entity('billing_spool_jobs')
@Index('IDX_billing_spool_jobs_tenant_created', ['tenantId', 'createdAt'])
@Index('IDX_billing_spool_jobs_status_updated', ['status', 'updatedAt'])
export class SpoolJobEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64, name: 'kind' })
  kind!: SpoolJobKind;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: SpoolJobStatus;

  @Column({ type: 'varchar', length: 16, name: 'output_target' })
  outputTarget!: SpoolOutputTarget;

  /** Human-readable label for the Spooler page ("Invoice R-2026-00012 by letter", "12 labels"). */
  @Column({ type: 'varchar', length: 255, name: 'title' })
  title!: string;

  /** Kind-specific input, validated when the job is created. */
  @Column({ type: 'jsonb', name: 'payload' })
  payload!: Record<string, unknown>;

  /** Document the job belongs to (sends): `invoice`, `credit_note`, `offer`. */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'document_type' })
  documentType?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'document_id' })
  documentId?: string | null;

  @Column({ type: 'int', default: 0, name: 'attempts' })
  attempts!: number;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'error' })
  error?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'file_name' })
  fileName?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'content_type' })
  contentType?: string | null;

  @Column({ type: 'int', nullable: true, name: 'file_size' })
  fileSize?: number | null;

  @Column({ type: 'uuid', nullable: true, name: 'created_by_user_id' })
  createdByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'started_at' })
  startedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'finished_at' })
  finishedAt?: Date | null;
}
