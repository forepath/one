import { createAes256GcmTransformer, createJsonAes256GcmTransformer } from '@forepath/shared/backend';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ServiceTypeEntity } from './service-type.entity';
import { SubscriptionEntity } from './subscription.entity';

export enum ProvisioningStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  FAILED = 'failed',
}

@Entity('billing_subscription_items')
export class SubscriptionItemEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'subscription_id' })
  subscriptionId!: string;

  @ManyToOne(() => SubscriptionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription?: SubscriptionEntity;

  @Column({ type: 'uuid', name: 'service_type_id' })
  serviceTypeId!: string;

  @ManyToOne(() => ServiceTypeEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_type_id' })
  serviceType?: ServiceTypeEntity;

  /** Plan/config snapshot; encrypted at rest via AES-256-GCM. */
  @Column({
    type: 'text',
    name: 'config_snapshot',
    nullable: true,
    transformer: createJsonAes256GcmTransformer(),
  })
  configSnapshot!: Record<string, unknown>;

  @Column({ type: 'enum', enum: ProvisioningStatus, name: 'provisioning_status', default: ProvisioningStatus.PENDING })
  provisioningStatus!: ProvisioningStatus;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'provider_reference' })
  providerReference?: string;

  /** Single-level subdomain for DNS (e.g. awesome-armadillo-abc12) used for hostname.baseDomain */
  @Column({ type: 'varchar', length: 128, nullable: true, name: 'hostname' })
  hostname?: string;

  /** Cached server info from provider (e.g. status, publicIp); no secrets, not encrypted */
  @Column({ type: 'jsonb', nullable: true, name: 'server_info_snapshot' })
  serverInfoSnapshot?: Record<string, unknown>;

  /** SSH private key for server access; encrypted at rest via AES-256-GCM. Never exposed via API. */
  @Column({
    type: 'text',
    nullable: true,
    name: 'ssh_private_key',
    transformer: createAes256GcmTransformer(),
  })
  sshPrivateKey?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
