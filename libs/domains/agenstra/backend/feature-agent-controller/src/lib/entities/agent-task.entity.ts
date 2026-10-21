import type { AgentTaskActorType, AgentTaskRunStatus } from '@forepath/agenstra/shared/util-opencode-config';
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

/**
 * Recurring task of one agent (workspace + agent scoped). Fired by the controller BullMQ coordinator when
 * `next_run_at` is due; managed by workspace users (REST) and by the agent itself (worker MCP → manager → socket).
 */
@Entity('agent_tasks')
@Index('IDX_agent_tasks_client_agent', ['clientId', 'agentId'])
@Index('IDX_agent_tasks_due', ['enabled', 'nextRunAt'])
export class AgentTaskEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client?: ClientEntity;

  @Column({ type: 'uuid', name: 'agent_id' })
  agentId!: string;

  @Column({ type: 'varchar', length: 200, name: 'title' })
  title!: string;

  @Column({ type: 'text', name: 'prompt' })
  prompt!: string;

  @Column({ type: 'varchar', length: 128, name: 'cron_expression' })
  cronExpression!: string;

  @Column({ type: 'varchar', length: 64, name: 'timezone', default: 'UTC' })
  timezone!: string;

  /** OpenCode `provider/model` (OpenCode has no auto model). */
  @Column({ type: 'varchar', length: 256, name: 'model' })
  model!: string;

  @Column({ type: 'boolean', name: 'enabled', default: true })
  enabled!: boolean;

  /** Next scheduled occurrence; `null` while disabled. */
  @Column({ type: 'timestamptz', name: 'next_run_at', nullable: true })
  nextRunAt?: Date | null;

  @Column({ type: 'timestamptz', name: 'last_run_at', nullable: true })
  lastRunAt?: Date | null;

  @Column({ type: 'varchar', length: 16, name: 'last_run_status', nullable: true })
  lastRunStatus?: AgentTaskRunStatus | null;

  @Column({ type: 'varchar', length: 16, name: 'created_by_type' })
  createdByType!: AgentTaskActorType;

  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId?: string | null;

  @Column({ type: 'varchar', length: 16, name: 'updated_by_type' })
  updatedByType!: AgentTaskActorType;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
