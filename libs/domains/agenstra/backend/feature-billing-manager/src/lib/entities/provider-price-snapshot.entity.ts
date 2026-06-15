import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('billing_provider_price_snapshots')
export class ProviderPriceSnapshotEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 100, name: 'provider' })
  provider!: string;

  @Column({ type: 'varchar', length: 255, name: 'provider_product_id' })
  providerProductId!: string;

  @Column({ type: 'jsonb', name: 'raw_price_payload', default: () => "'{}'::jsonb" })
  rawPricePayload!: Record<string, unknown>;

  @Column({ type: 'numeric', precision: 12, scale: 4, name: 'resolved_base_price' })
  resolvedBasePrice!: string;

  @Column({ type: 'varchar', length: 10, name: 'currency', default: 'EUR' })
  currency!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
