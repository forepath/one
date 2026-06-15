import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AgentEntity } from './agent.entity';

/**
 * Agent message entity representing a chat message bound to an agent.
 * Each message has an actor (user or agent) and the message content.
 */
@Entity('agent_messages')
export class AgentMessageEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'agent_id' })
  agentId!: string;

  @ManyToOne(() => AgentEntity, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent!: AgentEntity;

  @Column({ type: 'varchar', length: 50, name: 'actor' })
  actor!: string;

  @Column({ type: 'text', name: 'message' })
  message!: string;

  @Column({ type: 'boolean', name: 'filtered', default: false })
  filtered!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
