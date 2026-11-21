import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type BankImportStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'rolled_back';

/** One uploaded statement file (or a processor API sync run). The raw file is kept in file storage. */
@Entity('billing_accounting_bank_imports')
@Index('idx_billing_accounting_bank_imports_hash', ['fileSha256'])
export class AccountingBankImportEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'tenant_id' })
  tenantId?: string | null;

  /** Target account when the file has no account identifier (CSV, QIF) or the uploader chose one. */
  @Column({ type: 'uuid', nullable: true, name: 'financial_account_id' })
  financialAccountId?: string | null;

  @Column({ type: 'varchar', length: 255, name: 'file_name' })
  fileName!: string;

  @Column({ type: 'varchar', length: 64, name: 'file_sha256' })
  fileSha256!: string;

  @Column({ type: 'int', name: 'file_size' })
  fileSize!: number;

  @Column({ type: 'varchar', length: 512, nullable: true, name: 'storage_key' })
  storageKey?: string | null;

  /** Detected or chosen format (`camt.053`, `mt940`, `csv:sparkasse-camt`, `api:stripe` …). */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'format' })
  format?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true, name: 'format_version' })
  formatVersion?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true, name: 'encoding' })
  encoding?: string | null;

  /** CSV mapping used (preset key or saved mapping id). */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'csv_mapping' })
  csvMapping?: string | null;

  @Column({ type: 'varchar', length: 16, name: 'status', default: 'pending' })
  status!: BankImportStatus;

  @Column({ type: 'int', name: 'statement_count', default: 0 })
  statementCount!: number;

  @Column({ type: 'int', name: 'transaction_count', default: 0 })
  transactionCount!: number;

  @Column({ type: 'int', name: 'duplicate_count', default: 0 })
  duplicateCount!: number;

  @Column({ type: 'int', name: 'matched_count', default: 0 })
  matchedCount!: number;

  @Column({ type: 'jsonb', name: 'warnings', default: () => "'[]'" })
  warnings!: string[];

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'uploaded_by_user_id' })
  uploadedByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'completed_at' })
  completedAt?: Date | null;
}
