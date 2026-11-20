import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { InventorySerialUnitStatus } from '../constants/inventory.constants';

import { InventoryArticleEntity } from './inventory-article.entity';
import { InventoryCompartmentEntity } from './inventory-compartment.entity';
import { InventoryLendingEntity } from './inventory-lending.entity';

/**
 * One serial-tracked unit of an article. Units only change through movements: a putaway registers (or brings back)
 * a serial number, transfers move it between compartments, withdrawals and lendings take it out.
 */
@Entity('billing_inventory_serial_units')
@Index('uq_billing_inventory_serial_units_article_serial', ['tenantId', 'articleId', 'serialNumber'], { unique: true })
@Index('idx_billing_inventory_serial_units_location', ['articleId', 'compartmentId', 'status'])
export class InventorySerialUnitEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'uuid', name: 'article_id' })
  articleId!: string;

  @ManyToOne(() => InventoryArticleEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'article_id' })
  article?: InventoryArticleEntity;

  @Column({ type: 'varchar', length: 128, name: 'serial_number' })
  serialNumber!: string;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: InventorySerialUnitStatus;

  /** Compartment holding the unit (`in_stock` only). */
  @Column({ type: 'uuid', nullable: true, name: 'compartment_id' })
  compartmentId?: string | null;

  @ManyToOne(() => InventoryCompartmentEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'compartment_id' })
  compartment?: InventoryCompartmentEntity | null;

  /** Open lending holding the unit (`lent` only). */
  @Index('idx_billing_inventory_serial_units_lending')
  @Column({ type: 'uuid', nullable: true, name: 'lending_id' })
  lendingId?: string | null;

  @ManyToOne(() => InventoryLendingEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'lending_id' })
  lending?: InventoryLendingEntity | null;

  @Column({ type: 'uuid', nullable: true, name: 'last_movement_id' })
  lastMovementId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
