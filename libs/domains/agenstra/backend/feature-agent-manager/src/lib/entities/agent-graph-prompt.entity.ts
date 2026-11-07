import type {
  AgentGraphPromptReference,
  AgentGraphPromptSummary,
  AgentGraphReferenceKind,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { AgentEntity } from './agent.entity';

/** Context references of one prompt (turn) of an environment: attached, available, used and modified elements. */
@Entity('agent_graph_prompts')
@Index('IDX_agent_graph_prompts_agent_started', ['agentId', 'startedAt'])
@Index('UQ_agent_graph_prompts_agent_correlation', ['agentId', 'correlationId'], { unique: true })
export class AgentGraphPromptEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @ManyToOne(() => AgentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent?: AgentEntity;

  @Column({ name: 'correlation_id', type: 'varchar', length: 128 })
  correlationId!: string;

  @Column({ name: 'chat_session_id', type: 'uuid', nullable: true })
  chatSessionId!: string | null;

  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  origin!: AgentGraphPromptSummary['origin'];

  @Column({ type: 'text', nullable: true })
  excerpt!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  counts!: Record<AgentGraphReferenceKind, number>;

  @Column({ name: 'refs', type: 'jsonb', default: () => "'[]'::jsonb" })
  references!: AgentGraphPromptReference[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
