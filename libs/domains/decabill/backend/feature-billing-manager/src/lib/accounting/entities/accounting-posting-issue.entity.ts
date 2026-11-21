import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { JournalSourceType } from '../constants/accounting.constants';

/**
 * A business event whose booking failed (missing account mapping, closed fiscal year, …). The catch-up job retries
 * open issues; admins see them in the accounting console. Resolved issues keep their history.
 */
@Entity('billing_accounting_posting_issues')
@Index('uq_billing_accounting_posting_issues_key', ['idempotencyKey'], { unique: true })
export class AccountingPostingIssueEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 191, name: 'idempotency_key' })
  idempotencyKey!: string;

  @Column({ type: 'varchar', length: 32, name: 'source_type' })
  sourceType!: JournalSourceType;

  @Column({ type: 'varchar', length: 64, name: 'source_id' })
  sourceId!: string;

  @Column({ type: 'varchar', length: 48, name: 'source_event' })
  sourceEvent!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'tenant_id' })
  tenantId?: string | null;

  @Column({ type: 'text', name: 'error' })
  error!: string;

  @Column({ type: 'int', name: 'attempts', default: 1 })
  attempts!: number;

  @Column({ type: 'timestamp', nullable: true, name: 'resolved_at' })
  resolvedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
