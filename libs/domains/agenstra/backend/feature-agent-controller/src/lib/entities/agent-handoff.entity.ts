import type { AgentHandoffStatus } from '@forepath/agenstra/shared/util-opencode-config';
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
 * A task one agent handed over to another agent of the same workspace (worker MCP → manager → socket).
 * The target works on it in its own visible `handoff` chat; the response is delivered into the source chat.
 */
@Entity('agent_handoffs')
@Index('IDX_agent_handoffs_client_status', ['clientId', 'status'])
@Index('IDX_agent_handoffs_target_chat', ['targetAgentId', 'targetChatId'])
export class AgentHandoffEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client?: ClientEntity;

  @Column({ type: 'uuid', name: 'source_agent_id' })
  sourceAgentId!: string;

  @Column({ type: 'varchar', length: 255, name: 'source_agent_name' })
  sourceAgentName!: string;

  /** Visible chat the handoff was made in: the only place the response is delivered to. */
  @Column({ type: 'uuid', name: 'source_chat_id' })
  sourceChatId!: string;

  /** Model of the requesting chat: the turn that delivers the response runs with it. */
  @Column({ type: 'varchar', length: 256, name: 'source_model', nullable: true })
  sourceModel?: string | null;

  /** Set when the source chat is itself a handoff chat (chains). */
  @Column({ type: 'uuid', name: 'parent_handoff_id', nullable: true })
  parentHandoffId?: string | null;

  @Column({ type: 'int', name: 'depth', default: 1 })
  depth!: number;

  @Column({ type: 'uuid', name: 'target_agent_id' })
  targetAgentId!: string;

  @Column({ type: 'varchar', length: 255, name: 'target_agent_name' })
  targetAgentName!: string;

  /** Chat (kind `handoff`) opened on the target agent. */
  @Column({ type: 'uuid', name: 'target_chat_id' })
  targetChatId!: string;

  @Column({ type: 'varchar', length: 200, name: 'title' })
  title!: string;

  @Column({ type: 'text', name: 'message' })
  message!: string;

  /** OpenCode `provider/model` of the target turn; `null` uses the target's default model. */
  @Column({ type: 'varchar', length: 256, name: 'model', nullable: true })
  model?: string | null;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: AgentHandoffStatus;

  @Column({ type: 'text', name: 'response', nullable: true })
  response?: string | null;

  @Column({ type: 'varchar', length: 512, name: 'failure_message', nullable: true })
  failureMessage?: string | null;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt?: Date | null;

  /** When the response message was accepted by the source agent's chat. */
  @Column({ type: 'timestamptz', name: 'delivered_at', nullable: true })
  deliveredAt?: Date | null;

  @Column({ type: 'int', name: 'delivery_attempts', default: 0 })
  deliveryAttempts!: number;

  /** Set when the response cannot be delivered (requesting chat gone, retries exhausted); never redirected. */
  @Column({ type: 'varchar', length: 512, name: 'delivery_failure_message', nullable: true })
  deliveryFailureMessage?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
