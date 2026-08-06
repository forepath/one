import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import type { MeterAttachmentSource } from '../constants/meter-attachment.constants';
import { AddonEntity } from './addon.entity';
import { MeterEntity } from './meter.entity';

@Entity('billing_addon_meters')
@Unique('uq_billing_addon_meters_addon_meter', ['addonId', 'meterId'])
export class AddonMeterEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'addon_id' })
  addonId!: string;

  @ManyToOne(() => AddonEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'addon_id' })
  addon?: AddonEntity;

  @Column({ type: 'uuid', name: 'meter_id' })
  meterId!: string;

  @ManyToOne(() => MeterEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'meter_id' })
  meter?: MeterEntity;

  /** Null ⇒ use catalog default_unit_price_net. */
  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true, name: 'unit_price_net' })
  unitPriceNet?: string | null;

  @Column({ type: 'varchar', length: 16, name: 'source', default: 'manual' })
  source!: MeterAttachmentSource;

  @Column({ type: 'boolean', name: 'required', default: false })
  required!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
