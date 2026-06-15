import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('billing_audit_logs')
export class BillingAuditLogEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'correlation_id' })
  correlationId?: string;

  @Column({ type: 'varchar', length: 100, name: 'process' })
  process!: string;

  @Column({ type: 'uuid', nullable: true, name: 'invoice_id' })
  invoiceId?: string;

  @Column({ type: 'uuid', nullable: true, name: 'user_id' })
  userId?: string;

  @Column({ type: 'varchar', length: 20, name: 'level' })
  level!: string;

  @Column({ type: 'text', name: 'message' })
  message!: string;

  @Column({ type: 'jsonb', default: {}, name: 'context' })
  context!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
