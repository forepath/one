import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** A public address of the built-in IPAM (3.27): who has it, which node holds it, VRRP router id. */
@Entity('lw_public_addresses')
export class PublicAddressEntity {
  @PrimaryColumn({ type: 'varchar', length: 45, name: 'address' })
  address!: string;

  @Column({ type: 'varchar', length: 63, name: 'pool' })
  pool!: string;

  @Column({ type: 'varchar', length: 16, name: 'purpose' })
  purpose!: 'ingress' | 'port-forward' | 'egress' | 'dns' | 'vpn';

  /** Claim, e.g. `ingress/0`; null while cooling down. */
  @Column({ type: 'varchar', length: 128, name: 'owner', nullable: true })
  owner!: string | null;

  @Column({ type: 'varchar', length: 16, name: 'state' })
  state!: 'assigned' | 'cooldown';

  @Column({ type: 'timestamptz', name: 'released_at', nullable: true })
  releasedAt!: Date | null;

  /** Preferred holder (VRRP: highest priority; provider / none: the node the address is bound to). */
  @Column({ type: 'varchar', length: 63, name: 'holder', nullable: true })
  holder!: string | null;

  @Column({ type: 'integer', name: 'vrid', nullable: true })
  vrid!: number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
