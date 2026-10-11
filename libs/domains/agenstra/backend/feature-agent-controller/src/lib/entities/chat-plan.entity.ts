import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { ChatPlanPhase, ChatPlanStatus } from './chat-plan.enums';

/** Stored contextInjection snapshot used for explore/refine/execute turns. */
export type ChatPlanContextInjectionJson = {
  includeWorkspace?: boolean;
  environmentIds?: string[];
  autoEnrichmentEnabled?: boolean;
  ticketShas?: string[];
  ticketContexts?: string[];
  knowledgeShas?: string[];
  knowledgeContexts?: string[];
};

@Entity('chat_plan')
@Index('IDX_chat_plan_client_agent_chat', ['clientId', 'agentId', 'chatId'])
@Index('IDX_chat_plan_agent_chat_status', ['agentId', 'chatId', 'status'])
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

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
