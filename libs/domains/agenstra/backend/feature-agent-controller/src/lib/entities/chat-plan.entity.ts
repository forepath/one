import { createHash } from 'crypto';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { ChatPlanPhase, ChatPlanStatus } from './chat-plan.enums';

/** Stored contextInjection snapshot used for explore/refine/execute turns. */
export type ChatPlanContextInjectionJson = {
  includeWorkspace?: boolean;
  environmentIds?: string[];
  autoEnrichmentEnabled?: boolean;
  attachmentIds?: string[];
  attachmentContexts?: Array<{
    id: string;
    fileName: string;
    contentType: string;
    byteSize: number;
    agentPath: string;
    downloadUrl: string;
  }>;
  ticketShas?: string[];
  ticketContexts?: string[];
  knowledgeShas?: string[];
  knowledgeContexts?: string[];
  /** Other plans of the same environment linked as context. */
  planShas?: string[];
  planContexts?: string[];
  planContextRefs?: Array<{ sha: string; title?: string }>;
};

@Entity('chat_plan')
@Index('IDX_chat_plan_client_agent_chat', ['clientId', 'agentId', 'chatId'])
@Index('IDX_chat_plan_agent_chat_status', ['agentId', 'chatId', 'status'])
@Index('IDX_chat_plan_client_agent_started', ['clientId', 'agentId', 'startedAt'])
@Index('IDX_chat_plan_client_agent_long_sha', ['clientId', 'agentId', 'longSha'])
export class ChatPlanEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @Column({ type: 'uuid', name: 'agent_id' })
  agentId!: string;

  /** Visible chat session UUID this plan card belongs to. */
  @Column({ type: 'uuid', name: 'chat_id' })
  chatId!: string;

  @Column({
    type: 'enum',
    enum: ChatPlanStatus,
    enumName: 'chat_plan_status_enum',
    name: 'status',
  })
  status!: ChatPlanStatus;

  @Column({
    type: 'enum',
    enum: ChatPlanPhase,
    enumName: 'chat_plan_phase_enum',
    name: 'phase',
  })
  phase!: ChatPlanPhase;

  @Column({ type: 'text', name: 'source_prompt' })
  sourcePrompt!: string;

  @Column({ type: 'text', name: 'plan_markdown', nullable: true })
  planMarkdown?: string | null;

  @Column({ type: 'varchar', length: 512, name: 'summary', nullable: true })
  summary?: string | null;

  @Column({ type: 'jsonb', name: 'context_injection', nullable: true })
  contextInjection?: ChatPlanContextInjectionJson | null;

  @Column({ type: 'varchar', length: 256, name: 'model', nullable: true })
  model?: string | null;

  /** Hidden OpenCode resume suffix (`-plan-{id}`). */
  @Column({ type: 'varchar', length: 128, name: 'resume_session_suffix' })
  resumeSessionSuffix!: string;

  @Column({ type: 'boolean', name: 'completion_signal_seen', default: false })
  completionSignalSeen!: boolean;

  @Column({ type: 'varchar', length: 64, name: 'failure_code', nullable: true })
  failureCode?: string | null;

  @Column({ type: 'varchar', length: 512, name: 'failure_message', nullable: true })
  failureMessage?: string | null;

  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId?: string | null;

  @Column({ type: 'timestamptz', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt?: Date | null;

  /**
   * First time the plan entered `executing`. Once set the plan is read-only for good (retries of a failed execution
   * included): what was executed must stay what the activity log and the session show.
   */
  @Column({ type: 'timestamptz', name: 'execution_started_at', nullable: true })
  executionStartedAt?: Date | null;

  /** Last content edit by a workspace user (plans page). */
  @Column({ type: 'timestamptz', name: 'last_edited_at', nullable: true })
  lastEditedAt?: Date | null;

  @Column({ type: 'uuid', name: 'last_edited_by_user_id', nullable: true })
  lastEditedByUserId?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  /** Stable context reference (`plan:<sha>`), sha1 of the id like tickets and knowledge nodes. */
  @Column({ type: 'varchar', length: 40, nullable: true, name: 'long_sha' })
  longSha?: string | null;

  static deriveLongSha(planId: string): string {
    return createHash('sha1').update(planId).digest('hex');
  }
}
