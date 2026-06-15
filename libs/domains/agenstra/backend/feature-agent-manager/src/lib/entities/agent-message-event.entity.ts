import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AgentEntity } from './agent.entity';

@Entity('agent_message_events')
@Index(['agentId', 'correlationId', 'sequence'], { unique: true })
export class AgentMessageEventEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'agent_id' })
  agentId!: string;

  @ManyToOne(() => AgentEntity, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent!: AgentEntity;

  @Column({ type: 'varchar', length: 64, name: 'correlation_id' })
  correlationId!: string;

  @Column({ type: 'int', name: 'sequence' })
  sequence!: number;

  @Column({ type: 'varchar', length: 64, name: 'kind' })
  kind!: string;

  @Column({ type: 'jsonb', name: 'payload' })
  payload!: unknown;

  @Column({ type: 'timestamptz', name: 'event_timestamp' })
  eventTimestamp!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
