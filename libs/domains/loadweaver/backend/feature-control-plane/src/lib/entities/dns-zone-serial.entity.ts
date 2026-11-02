import { Column, Entity, PrimaryColumn } from 'typeorm';

/** SOA serial of a hosted zone (3.15): advances only when the zone content changes. */
@Entity('lw_dns_zone_serials')
export class DnsZoneSerialEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'zone' })
  zone!: string;

  @Column({ type: 'bigint', name: 'serial', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  serial!: number;

  @Column({ type: 'varchar', length: 64, name: 'content_hash' })
  contentHash!: string;
}
