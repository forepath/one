import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { AddonEntity } from './addon.entity';
import { MeterEntity } from './meter.entity';
import { SubscriptionEntity } from './subscription.entity';

export type UsageAttachmentType = 'plan' | 'addon';

@Entity('billing_usage_records')
export class UsageRecordEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'subscription_id' })
  subscriptionId!: string;

  @ManyToOne(() => SubscriptionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription?: SubscriptionEntity;

  @Column({ type: 'timestamp', name: 'period_start' })
  periodStart!: Date;

  @Column({ type: 'timestamp', name: 'period_end' })
  periodEnd!: Date;

  @Column({ type: 'varchar', length: 255, name: 'usage_source' })
  usageSource!: string;

  @Column({ type: 'jsonb', name: 'usage_payload', default: () => "'{}'::jsonb" })
  usagePayload!: Record<string, unknown>;

  @Column({ type: 'uuid', nullable: true, name: 'meter_id' })
  meterId?: string | null;

  @ManyToOne(() => MeterEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'meter_id' })
  meter?: MeterEntity | null;

  @Column({ type: 'numeric', precision: 18, scale: 6, nullable: true, name: 'value' })
  value?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true, name: 'attachment_type' })
  attachmentType?: UsageAttachmentType | null;

  @Column({ type: 'uuid', nullable: true, name: 'addon_id' })
  addonId?: string | null;

  @ManyToOne(() => AddonEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'addon_id' })
  addon?: AddonEntity | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
