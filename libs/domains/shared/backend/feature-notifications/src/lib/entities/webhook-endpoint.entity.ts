import { createAes256GcmTransformer } from '@shared/backend/util-crypto';
import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { WebhookDeliveryEntity } from './webhook-delivery.entity';

export enum WebhookHttpMethod {
  POST = 'POST',
  GET = 'GET',
}

export enum WebhookAuthType {
  NONE = 'none',
  AUTHORIZATION = 'authorization',
  CUSTOM_HEADER = 'custom_header',
  QUERY_PARAM = 'query_param',
}

@Entity('webhook_endpoints')
@Index('uq_webhook_endpoints_scope_name', ['scopeKey', 'name'], { unique: true })
export class WebhookEndpointEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'scope_key' })
  scopeKey!: string;

  @Column({ type: 'uuid', name: 'client_id', nullable: true })
  clientId?: string | null;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'text', name: 'url' })
  url!: string;

  @Column({ type: 'enum', enum: WebhookHttpMethod, name: 'http_method', default: WebhookHttpMethod.POST })
  httpMethod!: WebhookHttpMethod;

  @Column({ type: 'jsonb', name: 'subscribed_events', default: () => "'[]'::jsonb" })
  subscribedEvents!: string[];

  @Column({ type: 'boolean', name: 'enabled', default: true })
  enabled!: boolean;

  @Column({ type: 'enum', enum: WebhookAuthType, name: 'auth_type', default: WebhookAuthType.NONE })
  authType!: WebhookAuthType;

  @Column({ type: 'varchar', length: 255, name: 'auth_header_name', nullable: true })
  authHeaderName?: string | null;

  @Column({
    type: 'text',
    name: 'auth_value',
    nullable: true,
    transformer: createAes256GcmTransformer(),
  })
  authValue?: string | null;

  @Column({
    type: 'text',
    name: 'signing_secret',
    transformer: createAes256GcmTransformer(),
  })
  signingSecret!: string;

  @Column({ type: 'int', name: 'consecutive_failures', default: 0 })
  consecutiveFailures!: number;

  @Column({ type: 'text', name: 'disabled_reason', nullable: true })
  disabledReason?: string | null;

  @Column({ type: 'int', name: 'delivery_log_retention_days', nullable: true })
  deliveryLogRetentionDays?: number | null;

  @Column({ type: 'int', name: 'delivery_log_max_entries', nullable: true })
  deliveryLogMaxEntries?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => WebhookDeliveryEntity, (delivery) => delivery.endpoint)
  deliveries?: WebhookDeliveryEntity[];
}
