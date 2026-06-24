import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { DatevExportScope, DatevExportStatus } from '../constants/datev-export.constants';

@Entity('billing_datev_exports')
export class DatevExportEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({
    type: 'enum',
    enum: DatevExportScope,
    enumName: 'datev_export_scope_enum',
    default: DatevExportScope.TENANT,
  })
  scope!: DatevExportScope;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'int', name: 'period_year' })
  periodYear!: number;

  @Column({ type: 'int', name: 'period_month' })
  periodMonth!: number;

  @Column({
    type: 'enum',
    enum: DatevExportStatus,
    enumName: 'datev_export_status_enum',
    default: DatevExportStatus.PENDING,
  })
  status!: DatevExportStatus;

  @Column({ type: 'varchar', length: 512, nullable: true, name: 'storage_key' })
  storageKey?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'file_name' })
  fileName?: string;

  @Column({ type: 'int', default: 0, name: 'booking_count' })
  bookingCount!: number;

  @Column({ type: 'int', default: 0, name: 'invoice_count' })
  invoiceCount!: number;

  @Column({ type: 'int', default: 0, name: 'debtor_count' })
  debtorCount!: number;

  @Column({ type: 'jsonb', nullable: true, name: 'included_tenant_ids' })
  includedTenantIds?: string[];

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage?: string;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'triggered_by' })
  triggeredBy?: string;

  @Column({ type: 'timestamp', nullable: true, name: 'started_at' })
  startedAt?: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'completed_at' })
  completedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
