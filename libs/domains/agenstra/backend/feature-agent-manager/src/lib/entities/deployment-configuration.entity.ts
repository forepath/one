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
 * Deployment configuration entity representing CI/CD provider configuration for an agent.
 * Stores provider-specific credentials and settings encrypted at rest.
 */
@Entity('deployment_configurations')
export class DeploymentConfigurationEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'agent_id' })
  agentId!: string;

  @ManyToOne(() => AgentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent!: AgentEntity;

  @Column({ type: 'varchar', length: 50, name: 'provider_type' })
  providerType!: string;

  @Column({ type: 'varchar', length: 255, name: 'repository_id' })
  repositoryId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'default_branch' })
  defaultBranch?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'workflow_id' })
  workflowId?: string;

  /**
   * Provider-specific API token/credentials (encrypted at rest).
   * For GitHub: Personal Access Token or GitHub App token
   */
  @Column({
    type: 'varchar',
    length: 2048,
    name: 'provider_token',
    transformer: createAes256GcmTransformer(),
  })
  providerToken!: string;

  /**
   * Optional base URL for self-hosted instances (e.g., GitHub Enterprise Server).
   */
  @Column({ type: 'varchar', length: 512, nullable: true, name: 'provider_base_url' })
  providerBaseUrl?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
