import type { AgentTaskRunStatus, AgentTaskRunTrigger } from '@forepath/agenstra/shared/util-opencode-config';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import type { AgentTaskTranscriptEvent } from '../utils/agent-task-transcript.utils';

import { AgentTaskEntity } from './agent-task.entity';

/**
 * One execution of an {@link AgentTaskEntity}. `(task_id, scheduled_for)` is unique so a re-delivered BullMQ
 * job (retry, duplicate coordinator tick) never executes the same occurrence twice.
 */
@Entity('agent_task_runs')
@Unique('UQ_agent_task_runs_task_scheduled', ['taskId', 'scheduledFor'])
@Index('IDX_agent_task_runs_client_agent_started', ['clientId', 'agentId', 'startedAt'])
@Index('IDX_agent_task_runs_status_started', ['status', 'startedAt'])
/**
 * At most one active run per task (running or waiting for a handoff response), also under concurrent manual runs
 * (re-deliveries see a unique violation).
 */
@Index('UQ_agent_task_runs_one_running', ['taskId'], {
  unique: true,
  where: `"status" IN ('running', 'awaiting_handoff')`,
})
export class AgentTaskRunEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'task_id' })
  taskId!: string;

  @ManyToOne(() => AgentTaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task?: AgentTaskEntity;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @Column({ type: 'uuid', name: 'agent_id' })
  agentId!: string;

  @Column({ type: 'varchar', length: 16, name: 'trigger' })
  trigger!: AgentTaskRunTrigger;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: AgentTaskRunStatus;

  @Column({ type: 'timestamptz', name: 'scheduled_for' })
  scheduledFor!: Date;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt?: Date | null;

  /** Start of the run's current turn (first turn or a reaction to a handoff response); `null`: `started_at`. */
  @Column({ type: 'timestamptz', name: 'turn_started_at', nullable: true })
  turnStartedAt?: Date | null;

  /** Set while the run (`awaiting_handoff`) waits for the response to one of its handoffs. */
  @Column({ type: 'timestamptz', name: 'awaiting_handoff_since', nullable: true })
  awaitingHandoffSince?: Date | null;

  @Column({ type: 'text', name: 'output_excerpt', nullable: true })
  outputExcerpt?: string | null;

  @Column({ type: 'varchar', length: 512, name: 'failure_message', nullable: true })
  failureMessage?: string | null;

  /** Chat events of the run's turn in the task session (rendered as session history in the console). */
  @Column({ type: 'jsonb', name: 'transcript', nullable: true })
  transcript?: AgentTaskTranscriptEvent[] | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
