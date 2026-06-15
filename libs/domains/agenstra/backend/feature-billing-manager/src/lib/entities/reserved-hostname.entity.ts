import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';

import { SubscriptionItemEntity } from './subscription-item.entity';

/**
 * Tracks reserved subdomain hostnames (e.g. awesome-armadillo-abc12) for provisioned servers.
 * Single-level subdomains only (no dots) so SSL certificates can be issued for hostname.baseDomain.
 */
@Entity('billing_reserved_hostnames')
export class ReservedHostnameEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 128, name: 'hostname', unique: true })
  hostname!: string;

  @Column({ type: 'uuid', name: 'subscription_item_id', unique: true })
  subscriptionItemId!: string;

  @OneToOne(() => SubscriptionItemEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_item_id' })
  subscriptionItem?: SubscriptionItemEntity;
}
