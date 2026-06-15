import { createAes256GcmTransformer } from '@forepath/shared/backend';
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
 * Agent environment variable entity representing an environment variable bound to an agent.
 * Each variable has a variable name and a content.
 */
@Entity('agent_environment_variables')
export class AgentEnvironmentVariableEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'agent_id' })
  agentId!: string;

  @ManyToOne(() => AgentEntity, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent!: AgentEntity;

  @Column({ type: 'varchar', length: 255, name: 'variable' })
  variable!: string;

  @Column({
    type: 'text',
    nullable: true,
    name: 'content',
    transformer: createAes256GcmTransformer(),
  })
  content?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
