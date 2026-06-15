import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { DeploymentConfigurationEntity } from './deployment-configuration.entity';

/**
 * Deployment run entity representing a pipeline/workflow run execution.
 * Stores run metadata and status for tracking deployment history.
 */
@Entity('deployment_runs')
export class DeploymentRunEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'configuration_id' })
  configurationId!: string;

  @ManyToOne(() => DeploymentConfigurationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'configuration_id' })
  configuration!: DeploymentConfigurationEntity;

  /**
   * Provider-specific run identifier (e.g., GitHub Actions run ID).
   */
  @Column({ type: 'varchar', length: 255, name: 'provider_run_id' })
  providerRunId!: string;

  @Column({ type: 'varchar', length: 255, name: 'run_name' })
  runName!: string;

  @Column({ type: 'varchar', length: 50, name: 'status' })
  status!: string;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'conclusion' })
  conclusion?: string;

  @Column({ type: 'varchar', length: 255, name: 'ref' })
  ref!: string;

  @Column({ type: 'varchar', length: 40, name: 'sha' })
  sha!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'workflow_id' })
  workflowId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'workflow_name' })
  workflowName?: string;

  @Column({ type: 'timestamp', nullable: true, name: 'started_at' })
  startedAt?: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'completed_at' })
  completedAt?: Date;

  @Column({ type: 'text', nullable: true, name: 'html_url' })
  htmlUrl?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
