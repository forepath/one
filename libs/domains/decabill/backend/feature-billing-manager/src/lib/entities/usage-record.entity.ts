import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { SubscriptionEntity } from './subscription.entity';

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
