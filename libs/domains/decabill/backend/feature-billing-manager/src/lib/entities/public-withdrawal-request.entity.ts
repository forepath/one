import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { SubscriptionEntity } from './subscription.entity';

@Entity('billing_public_withdrawal_requests')
export class PublicWithdrawalRequestEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'subscription_id' })
  subscriptionId!: string;

  @ManyToOne(() => SubscriptionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription?: SubscriptionEntity;

  /** Confirmation code; encrypted at rest via AES-256-GCM. */
  @Column({
    type: 'text',
    name: 'confirmation_code',
    transformer: createAes256GcmTransformer(),
  })
  confirmationCode!: string;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'code_verified_at' })
  codeVerifiedAt?: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'confirmed_at' })
  confirmedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
