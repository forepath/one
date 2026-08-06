import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

export type MeterAggregator = 'max' | 'min' | 'avg' | 'first' | 'last' | 'sum' | 'sum_positive_deltas';

export const METER_AGGREGATORS: MeterAggregator[] = [
  'max',
  'min',
  'avg',
  'first',
  'last',
  'sum',
  'sum_positive_deltas',
];

@Entity('billing_meters')
@Unique('uq_billing_meters_tenant_key', ['tenantId', 'key'])
export class MeterEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 100, name: 'key' })
  key!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'text', nullable: true, name: 'description' })
  description?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'unit_label' })
  unitLabel?: string | null;

  @Column({ type: 'varchar', length: 32, name: 'aggregator' })
  aggregator!: MeterAggregator;

  @Column({ type: 'numeric', precision: 12, scale: 4, name: 'default_unit_price_net', default: 0 })
  defaultUnitPriceNet!: string;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
