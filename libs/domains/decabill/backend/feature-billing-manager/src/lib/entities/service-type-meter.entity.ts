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
import { MeterEntity } from './meter.entity';
import { ServiceTypeEntity } from './service-type.entity';

@Entity('billing_service_type_meters')
@Unique('uq_billing_service_type_meters_type_meter', ['serviceTypeId', 'meterId'])
export class ServiceTypeMeterEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'service_type_id' })
  serviceTypeId!: string;

  @ManyToOne(() => ServiceTypeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_type_id' })
  serviceType?: ServiceTypeEntity;

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
