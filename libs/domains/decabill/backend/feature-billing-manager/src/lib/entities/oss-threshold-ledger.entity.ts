import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('billing_oss_threshold_ledgers')
export class OssThresholdLedgerEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'unified' })
  tenantId!: string;

  @Column({ type: 'int', name: 'calendar_year' })
  calendarYear!: number;

  @Column({ type: 'decimal', precision: 14, scale: 4, name: 'cross_border_b2c_net_total', default: 0 })
  crossBorderB2cNetTotal!: number;

  @Column({ type: 'decimal', precision: 14, scale: 4, name: 'threshold_eur', default: 10000 })
  thresholdEur!: number;

  @Column({ type: 'timestamp', nullable: true, name: 'threshold_exceeded_at' })
  thresholdExceededAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
