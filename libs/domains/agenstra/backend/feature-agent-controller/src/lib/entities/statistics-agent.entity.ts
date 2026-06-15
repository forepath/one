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

import { StatisticsClientEntity } from './statistics-client.entity';

/**
 * Shadow table for agents. Stores references to original agents for statistics
 * correlation. Does not contain secrets (password, vnc_password, ssh_password).
 * Created on agent create via proxy or on first chat from unknown agent.
 */
@Entity('statistics_agents')
@Index('IDX_statistics_agents_original_agent_id', ['originalAgentId'], { unique: true })
@Index('IDX_statistics_agents_statistics_client_id', ['statisticsClientId'])
export class StatisticsAgentEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'original_agent_id' })
  originalAgentId!: string;

  @Column({ type: 'uuid', name: 'statistics_client_id' })
  statisticsClientId!: string;

  @ManyToOne(() => StatisticsClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'statistics_client_id' })
  statisticsClient?: StatisticsClientEntity;

  @Column({ type: 'varchar', length: 50, default: 'cursor', name: 'agent_type' })
  agentType!: string;

  @Column({ type: 'varchar', length: 50, default: 'generic', name: 'container_type' })
  containerType!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'name' })
  name?: string;

  @Column({ type: 'text', nullable: true, name: 'description' })
  description?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
