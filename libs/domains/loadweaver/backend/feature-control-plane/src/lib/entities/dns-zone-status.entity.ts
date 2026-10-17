import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Last reconciliation of one zone at one provider (3.15): when, errors, names it may not touch. */
@Entity('lw_dns_zone_status')
export class DnsZoneStatusEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'zone' })
  zone!: string;

  @PrimaryColumn({ type: 'varchar', length: 63, name: 'provider' })
  provider!: string;

  @Column({ type: 'timestamptz', name: 'synced_at', nullable: true })
  syncedAt!: Date | null;

  @Column({ type: 'varchar', length: 1000, name: 'error', nullable: true })
  error!: string | null;

  @Column({ type: 'jsonb', name: 'conflicts', default: () => "'[]'" })
  conflicts!: string[];

  @Column({ type: 'integer', name: 'changes', default: 0 })
  changes!: number;

  /** Secondaries: how far behind the primary they are, when they are. */
  @Column({ type: 'varchar', length: 512, name: 'drift', nullable: true })
  drift!: string | null;
}
