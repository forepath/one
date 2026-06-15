import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { StatisticsAgentEntity } from './statistics-agent.entity';
import { StatisticsClientUserEntity } from './statistics-client-user.entity';
import { StatisticsClientEntity } from './statistics-client.entity';
import { StatisticsProvisioningReferenceEntity } from './statistics-provisioning-reference.entity';
import { StatisticsUserEntity } from './statistics-user.entity';

export enum StatisticsEntityEventType {
  CREATED = 'created',
  UPDATED = 'updated',
  DELETED = 'deleted',
}

export enum StatisticsEntityType {
  USER = 'user',
  CLIENT = 'client',
  AGENT = 'agent',
  CLIENT_USER = 'client_user',
  PROVISIONING_REFERENCE = 'provisioning_reference',
}

/**
 * Records entity lifecycle events (created/deleted) for users, clients, agents,
 * client-users, and provisioning references.
 */
@Entity('statistics_entity_events')
@Index('IDX_statistics_entity_events_entity_type_occurred_at', ['entityType', 'occurredAt'])
@Index('IDX_statistics_entity_events_original_entity_id', ['originalEntityId'])
export class StatisticsEntityEventEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'enum', enum: StatisticsEntityEventType, name: 'event_type' })
  eventType!: StatisticsEntityEventType;

  @Column({ type: 'enum', enum: StatisticsEntityType, name: 'entity_type' })
  entityType!: StatisticsEntityType;

  @Column({ type: 'uuid', name: 'original_entity_id' })
  originalEntityId!: string;

  @Column({ type: 'uuid', nullable: true, name: 'statistics_user_id' })
  statisticsUserId?: string;

  @ManyToOne(() => StatisticsUserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'statistics_user_id' })
  statisticsUser?: StatisticsUserEntity;

  @Column({ type: 'uuid', nullable: true, name: 'statistics_users_id' })
  statisticsUsersId?: string;

  @ManyToOne(() => StatisticsUserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'statistics_users_id' })
  statisticsUsers?: StatisticsUserEntity;

  @Column({ type: 'uuid', nullable: true, name: 'statistics_clients_id' })
  statisticsClientsId?: string;

  @ManyToOne(() => StatisticsClientEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'statistics_clients_id' })
  statisticsClients?: StatisticsClientEntity;

  @Column({ type: 'uuid', nullable: true, name: 'statistics_agents_id' })
  statisticsAgentsId?: string;

  @ManyToOne(() => StatisticsAgentEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'statistics_agents_id' })
  statisticsAgents?: StatisticsAgentEntity;

  @Column({ type: 'uuid', nullable: true, name: 'statistics_client_users_id' })
  statisticsClientUsersId?: string;

  @ManyToOne(() => StatisticsClientUserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'statistics_client_users_id' })
  statisticsClientUsers?: StatisticsClientUserEntity;

  @Column({ type: 'uuid', nullable: true, name: 'statistics_provisioning_references_id' })
  statisticsProvisioningReferencesId?: string;

  @ManyToOne(() => StatisticsProvisioningReferenceEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'statistics_provisioning_references_id' })
  statisticsProvisioningReferences?: StatisticsProvisioningReferenceEntity;

  @Column({ type: 'timestamp', name: 'occurred_at' })
  occurredAt!: Date;
}
