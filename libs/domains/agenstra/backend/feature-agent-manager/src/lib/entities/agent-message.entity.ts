import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AgentChatSessionEntity } from './agent-chat-session.entity';
import { AgentEntity } from './agent.entity';

export interface AgentMessageAttachmentJson {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  downloadUrl: string;
  agentPath?: string | null;
}

/**
 * Agent message entity representing a chat message bound to an agent chat session.
 * Each message has an actor (user or agent) and the message content.
 */
@Entity('agent_messages')
export class AgentMessageEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'agent_id' })
  agentId!: string;

  @ManyToOne(() => AgentEntity, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent!: AgentEntity;

  @Column({ type: 'uuid', name: 'chat_session_id' })
  chatSessionId!: string;

  @ManyToOne(() => AgentChatSessionEntity, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'chat_session_id' })
  chatSession!: AgentChatSessionEntity;

  @Column({ type: 'varchar', length: 50, name: 'actor' })
  actor!: string;

  @Column({ type: 'text', name: 'message' })
  message!: string;

  @Column({ type: 'boolean', name: 'filtered', default: false })
  filtered!: boolean;

  @Column({ type: 'jsonb', name: 'attachments', nullable: true })
  attachments?: AgentMessageAttachmentJson[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
