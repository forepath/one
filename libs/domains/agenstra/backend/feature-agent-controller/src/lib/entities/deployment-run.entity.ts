import type {
  DeploymentRunConclusion,
  DeploymentRunStatus,
  DeploymentRunTriggerType,
} from '@forepath/agenstra/shared/util-opencode-config';
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

import { DeploymentWorkflowEntity } from './deployment-workflow.entity';

/**
 * Run of a deployment workflow (history). Runs triggered through Agenstra are recorded on trigger; runs started on the
 * provider are synced in as `external`. Active runs are polled until they complete.
 */
@Entity('deployment_runs')
@Index('IDX_deployment_runs_client_created', ['clientId', 'createdAt'])
@Index('IDX_deployment_runs_workflow_created', ['workflowId', 'createdAt'])
@Index('IDX_deployment_runs_status', ['status'])
@Index('UQ_deployment_runs_workflow_provider_run', ['workflowId', 'providerRunId'], { unique: true })
export class DeploymentRunEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @Column({ type: 'uuid', name: 'workflow_id' })
  workflowId!: string;

  @ManyToOne(() => DeploymentWorkflowEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_id' })
  workflowEntity?: DeploymentWorkflowEntity;

  @Column({ type: 'uuid', name: 'agent_id', nullable: true })
  agentId?: string | null;

  /** Provider run id (GitHub run id, GitLab pipeline id, Jenkins `job#build` / `queue:{id}` until it starts). */
  @Column({ type: 'varchar', length: 255, name: 'provider_run_id', nullable: true })
  providerRunId?: string | null;

  @Column({ type: 'varchar', length: 255, name: 'name', nullable: true })
  name?: string | null;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: DeploymentRunStatus;

  @Column({ type: 'varchar', length: 16, name: 'conclusion', nullable: true })
  conclusion?: DeploymentRunConclusion | null;

  @Column({ type: 'varchar', length: 255, name: 'ref', nullable: true })
  ref?: string | null;

  @Column({ type: 'varchar', length: 64, name: 'sha', nullable: true })
  sha?: string | null;

  @Column({ type: 'text', name: 'url', nullable: true })
  url?: string | null;

  @Column({ type: 'jsonb', name: 'inputs', default: () => "'{}'::jsonb" })
  inputs!: Record<string, string>;

  @Column({ type: 'varchar', length: 16, name: 'triggered_by_type' })
  triggeredByType!: DeploymentRunTriggerType;

  @Column({ type: 'uuid', name: 'triggered_by_user_id', nullable: true })
  triggeredByUserId?: string | null;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
