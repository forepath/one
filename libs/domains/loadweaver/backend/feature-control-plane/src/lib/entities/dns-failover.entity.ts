import { Column, Entity, PrimaryColumn } from 'typeorm';

import type { FailoverState } from '../dns/dns-failover.utils';

/** Latest result of one probe from one node (3.28). */
@Entity('lw_probe_results')
export class ProbeResultEntity {
  @PrimaryColumn({ type: 'varchar', length: 192, name: 'probe_id' })
  probeId!: string;

  @PrimaryColumn({ type: 'varchar', length: 63, name: 'node' })
  node!: string;

  @Column({ type: 'boolean', name: 'ok' })
  ok!: boolean;

  @Column({ type: 'integer', name: 'latency_ms', nullable: true })
  latencyMs!: number | null;

  @Column({ type: 'varchar', length: 256, name: 'error', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamptz', name: 'at' })
  at!: Date;
}

/** Engine state of one DNS failover: endpoint health, current answer, pending manual fail-back. */
@Entity('lw_dns_failover_state')
export class DnsFailoverStateEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'name' })
  name!: string;

  @Column({ type: 'jsonb', name: 'state' })
  state!: FailoverState;

  @Column({ type: 'timestamptz', name: 'switched_at', nullable: true })
  switchedAt!: Date | null;

  /** Whether every authoritative server answered the last switch (3.28). */
  @Column({ type: 'jsonb', name: 'propagation', nullable: true })
  propagation!: { done: boolean; lagging: string[]; checkedAt: string } | null;

  /** An operator confirmed the fail-back of a `manual` failover. */
  @Column({ type: 'boolean', name: 'failback_confirmed', default: false })
  failbackConfirmed!: boolean;
}
