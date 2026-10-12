import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { StatisticsAgentEntity } from './statistics-agent.entity';
import { StatisticsClientEntity } from './statistics-client.entity';

/**
 * Egress guard decisions (web traffic filtering) ingested from agent managers.
 * Each row is an aggregate of identical decisions within one manager collection cycle
 * (`count` = number of requests / lookups / connection attempts).
 */
@Entity('statistics_egress_events')
@Index('IDX_statistics_egress_events_client_occurred_at', ['statisticsClientId', 'occurredAt'])
@Index('IDX_statistics_egress_events_agent_occurred_at', ['statisticsAgentId', 'occurredAt'])
@Index('IDX_statistics_egress_events_decision_occurred_at', ['decision', 'occurredAt'])
@Index('UQ_statistics_egress_events_source', ['statisticsClientId', 'sourceSeq'], { unique: true })
export class StatisticsEgressEventEntity {
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

  /** Manager-side `agent_egress_events.seq` (idempotent ingestion per workspace). */
  @Column({ type: 'bigint', name: 'source_seq' })
  sourceSeq!: string;

  /** `web` | `dns` | `network` | `guard` */
  @Column({ type: 'varchar', length: 16, name: 'kind' })
  kind!: string;

  /** `allowed` | `blocked` | `observed` | `error` */
  @Column({ type: 'varchar', length: 16, name: 'decision' })
  decision!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'host' })
  host?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'rule' })
  rule?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'matched_entry' })
  matchedEntry?: string | null;

  /** Layer that contributed the matched entry (`global` | `workspace` | `environment`). */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'matched_source' })
  matchedSource?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'method' })
  method?: string | null;

  @Column({ type: 'int', nullable: true, name: 'http_status' })
  httpStatus?: number | null;

  @Column({ type: 'text', nullable: true, name: 'sample_url' })
  sampleUrl?: string | null;

  @Column({ type: 'int', name: 'count', default: 1 })
  count!: number;

  @Column({ type: 'bigint', name: 'bytes_in', default: 0 })
  bytesIn!: string;

  @Column({ type: 'bigint', name: 'bytes_out', default: 0 })
  bytesOut!: string;

  @Column({ type: 'varchar', length: 16, nullable: true, name: 'mode' })
  mode?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'policy_revision' })
  policyRevision?: string | null;

  @Column({ type: 'text', nullable: true, name: 'message' })
  message?: string | null;

  @Column({ type: 'timestamp', name: 'first_seen_at' })
  firstSeenAt!: Date;

  /** Last occurrence within the aggregate (time axis for audit charts). */
  @Column({ type: 'timestamp', name: 'occurred_at' })
  occurredAt!: Date;
}
