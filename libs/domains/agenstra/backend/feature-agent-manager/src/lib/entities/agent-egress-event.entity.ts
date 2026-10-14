import type {
  EgressDecision,
  EgressEventKind,
  EgressRule,
  PlatformPolicyLayer,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Aggregated egress guard decisions (one row per distinct decision per collection cycle).
 * Rows are pulled by the agent controller via a monotonic `seq` cursor and pruned after retention.
 * No foreign key to `agents`: decisions of deleted environments must remain collectable for audit.
 */
@Entity('agent_egress_events')
@Index('IDX_agent_egress_events_agent_last_seen', ['agentId', 'lastSeenAt'])
@Index('IDX_agent_egress_events_created_at', ['createdAt'])
export class AgentEgressEventEntity {
  /** Monotonic cursor (bigint; TypeORM returns it as a string). */
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'seq' })
  seq!: string;

  @Column({ type: 'uuid', name: 'agent_id' })
  agentId!: string;

  @Column({ type: 'varchar', length: 16, name: 'kind' })
  kind!: EgressEventKind;

  @Column({ type: 'varchar', length: 16, name: 'decision' })
  decision!: EgressDecision;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'host' })
  host?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'rule' })
  rule?: EgressRule | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'matched_entry' })
  matchedEntry?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true, name: 'matched_source' })
  matchedSource?: PlatformPolicyLayer | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'method' })
  method?: string | null;

  @Column({ type: 'int', nullable: true, name: 'http_status' })
  httpStatus?: number | null;

  /** Last observed URL (plain HTTP only; query strings / credentials stripped). */
  @Column({ type: 'text', nullable: true, name: 'sample_url' })
  sampleUrl?: string | null;

  @Column({ type: 'int', default: 1, name: 'count' })
  count!: number;

  @Column({ type: 'bigint', default: 0, name: 'bytes_in' })
  bytesIn!: string;

  @Column({ type: 'bigint', default: 0, name: 'bytes_out' })
  bytesOut!: string;

  @Column({ type: 'timestamptz', name: 'first_seen_at' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamptz', name: 'last_seen_at' })
  lastSeenAt!: Date;

  @Column({ type: 'varchar', length: 16, nullable: true, name: 'mode' })
  mode?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'policy_revision' })
  policyRevision?: string | null;

  /** Guard failure details (kind `guard`). */
  @Column({ type: 'text', nullable: true, name: 'message' })
  message?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
