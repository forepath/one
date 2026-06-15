import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { StatisticsAgentEntity } from './statistics-agent.entity';
import { StatisticsClientEntity } from './statistics-client.entity';
import { StatisticsUserEntity } from './statistics-user.entity';

export enum ChatDirection {
  INPUT = 'input',
  OUTPUT = 'output',
}

export enum StatisticsInteractionKind {
  CHAT = 'chat',
  PROMPT_ENHANCEMENT = 'prompt_enhancement',
  TICKET_BODY_GENERATION = 'ticket_body_generation',
  AUTO_CONTEXT_ENRICHMENT = 'auto_context_enrichment',
  AUTONOMOUS_TICKET_RUN = 'autonomous_ticket_run',
  AUTONOMOUS_TICKET_RUN_TURN = 'autonomous_ticket_run_turn',
  /** Ephemeral remote chat used only to propose a Conventional Commits subject before `git commit`. */
  AUTONOMOUS_TICKET_COMMIT_MESSAGE = 'autonomous_ticket_commit_message',
}

/**
 * Records chat I/O (words and characters) per agent at a given time.
 */
@Entity('statistics_chat_io')
@Index('IDX_statistics_chat_io_statistics_agent_id_occurred_at', ['statisticsAgentId', 'occurredAt'])
@Index('IDX_statistics_chat_io_statistics_client_id_occurred_at', ['statisticsClientId', 'occurredAt'])
export class StatisticsChatIoEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', nullable: true, name: 'statistics_agent_id' })
  statisticsAgentId?: string;

  @ManyToOne(() => StatisticsAgentEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'statistics_agent_id' })
  statisticsAgent?: StatisticsAgentEntity;

  @Column({ type: 'uuid', name: 'statistics_client_id' })
  statisticsClientId!: string;

  @ManyToOne(() => StatisticsClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'statistics_client_id' })
  statisticsClient?: StatisticsClientEntity;

  @Column({ type: 'uuid', nullable: true, name: 'statistics_user_id' })
  statisticsUserId?: string;

  @ManyToOne(() => StatisticsUserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'statistics_user_id' })
  statisticsUser?: StatisticsUserEntity;

  @Column({ type: 'enum', enum: ChatDirection, name: 'direction' })
  direction!: ChatDirection;

  @Column({
    type: 'enum',
    enum: StatisticsInteractionKind,
    name: 'interaction_kind',
    default: StatisticsInteractionKind.CHAT,
  })
  interactionKind!: StatisticsInteractionKind;

  @Column({ type: 'int', name: 'word_count' })
  wordCount!: number;

  @Column({ type: 'int', name: 'char_count' })
  charCount!: number;

  @Column({ type: 'timestamp', name: 'occurred_at' })
  occurredAt!: Date;
}
