import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { WebhookEndpointEntity } from './webhook-endpoint.entity';

@Entity('webhook_deliveries')
@Index('idx_webhook_deliveries_endpoint_created_at', ['endpointId', 'createdAt'])
export class WebhookDeliveryEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'endpoint_id' })
  endpointId!: string;

  @ManyToOne(() => WebhookEndpointEntity, (endpoint) => endpoint.deliveries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'endpoint_id' })
  endpoint?: WebhookEndpointEntity;

  @Column({ type: 'uuid', name: 'event_id' })
  eventId!: string;

  @Column({ type: 'varchar', length: 128, name: 'event_type' })
  eventType!: string;

  @Column({ type: 'jsonb', name: 'payload', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: 'int', name: 'http_status', nullable: true })
  httpStatus?: number | null;

  @Column({ type: 'text', name: 'response_body', nullable: true })
  responseBody?: string | null;

  @Column({ type: 'boolean', name: 'success' })
  success!: boolean;

  @Column({ type: 'int', name: 'attempt' })
  attempt!: number;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
