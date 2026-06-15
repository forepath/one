import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { StatisticsAgentEntity } from './statistics-agent.entity';
import { StatisticsClientEntity } from './statistics-client.entity';
import { StatisticsUserEntity } from './statistics-user.entity';

export enum FilterFlagDirection {
  INCOMING = 'incoming',
  OUTGOING = 'outgoing',
}

/**
 * Records chat messages that were flagged/modified by filters but NOT dropped.
 * These messages were allowed through (possibly modified) and appear in Chat I/O.
 */
@Entity('statistics_chat_filter_flags')
@Index('IDX_statistics_chat_filter_flags_statistics_agent_id_occurred_at', ['statisticsAgentId', 'occurredAt'])
@Index('IDX_statistics_chat_filter_flags_filter_type_occurred_at', ['filterType', 'occurredAt'])
export class StatisticsChatFilterFlagEntity {
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

  @Column({ type: 'varchar', length: 100, name: 'filter_type' })
  filterType!: string;

  @Column({ type: 'varchar', length: 255, name: 'filter_display_name' })
  filterDisplayName!: string;

  @Column({ type: 'text', nullable: true, name: 'filter_reason' })
  filterReason?: string;

  @Column({ type: 'enum', enum: FilterFlagDirection, name: 'direction' })
  direction!: FilterFlagDirection;

  @Column({ type: 'int', name: 'word_count', default: 0 })
  wordCount!: number;

  @Column({ type: 'int', name: 'char_count', default: 0 })
  charCount!: number;

  @Column({ type: 'timestamp', name: 'occurred_at' })
  occurredAt!: Date;
}
