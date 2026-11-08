import type {
  DeploymentRunConclusion,
  DeploymentRunStatus,
  DeploymentWorkflowActorType,
  DeploymentWorkflowScope,
} from '@forepath/agenstra/shared/util-opencode-config';
import { ClientEntity } from '@forepath/identity/backend';
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

import { DeploymentConnectionEntity } from './deployment-connection.entity';

/**
 * Deployment workflow of one workspace on top of a deployment connection. `scope = global` makes it available to every
 * environment of the workspace; `scope = environments` only to `agent_ids`. Workflows proposed by an environment are
 * assigned to that environment only and stay pending (`approved_at` null) until a workspace admin approves them.
 */
@Entity('deployment_workflows')
@Index('IDX_deployment_workflows_client', ['clientId'])
@Index('IDX_deployment_workflows_connection', ['connectionId'])
export class DeploymentWorkflowEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client?: ClientEntity;

  /** Connections in use cannot be deleted (RESTRICT); workflows have to be moved or removed first. */
  @Column({ type: 'uuid', name: 'connection_id' })
  connectionId!: string;

  @ManyToOne(() => DeploymentConnectionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'connection_id' })
  connection?: DeploymentConnectionEntity;

  @Column({ type: 'varchar', length: 200, name: 'name' })
  name!: string;

  @Column({ type: 'text', name: 'description', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 512, name: 'repository' })
  repository!: string;

  @Column({ type: 'varchar', length: 512, name: 'workflow', nullable: true })
  workflow?: string | null;

  @Column({ type: 'varchar', length: 255, name: 'default_ref', nullable: true })
  defaultRef?: string | null;

  @Column({ type: 'jsonb', name: 'default_inputs', default: () => "'{}'::jsonb" })
  defaultInputs!: Record<string, string>;

  @Column({ type: 'varchar', length: 16, name: 'scope', default: 'global' })
  scope!: DeploymentWorkflowScope;

  @Column({ type: 'jsonb', name: 'agent_ids', default: () => "'[]'::jsonb" })
  agentIds!: string[];

  @Column({ type: 'boolean', name: 'agent_trigger_enabled', default: false })
  agentTriggerEnabled!: boolean;

  @Column({ type: 'boolean', name: 'enabled', default: true })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 16, name: 'last_run_status', nullable: true })
  lastRunStatus?: DeploymentRunStatus | null;

  @Column({ type: 'varchar', length: 16, name: 'last_run_conclusion', nullable: true })
  lastRunConclusion?: DeploymentRunConclusion | null;

  @Column({ type: 'timestamptz', name: 'last_run_at', nullable: true })
  lastRunAt?: Date | null;

  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId?: string | null;

  /**
   * Set when a workspace user created / approved the current content. Null: proposed or changed by an environment
   * (MCP) and waiting for a workspace admin; nobody can start runs of a pending workflow.
   */
  @Column({ type: 'timestamptz', name: 'approved_at', nullable: true })
  approvedAt?: Date | null;

  @Column({ type: 'uuid', name: 'approved_by_user_id', nullable: true })
  approvedByUserId?: string | null;

  @Column({ type: 'varchar', length: 16, name: 'created_by_type', default: 'user' })
  createdByType!: DeploymentWorkflowActorType;

  @Column({ type: 'varchar', length: 16, name: 'updated_by_type', default: 'user' })
  updatedByType!: DeploymentWorkflowActorType;

  /** Environment that proposed the workflow (`created_by_type = agent`). */
  @Column({ type: 'uuid', name: 'created_by_agent_id', nullable: true })
  createdByAgentId?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
