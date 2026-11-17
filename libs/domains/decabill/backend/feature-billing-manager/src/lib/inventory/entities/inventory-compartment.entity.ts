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

import { InventoryWarehouseEntity } from './inventory-warehouse.entity';

/** A storage compartment (bin / shelf slot) inside a warehouse. Holds any number of articles. */
@Entity('billing_inventory_compartments')
@Index('uq_billing_inventory_compartments_warehouse_code', ['warehouseId', 'code'], { unique: true })
export class InventoryCompartmentEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId!: string;

  @ManyToOne(() => InventoryWarehouseEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse?: InventoryWarehouseEntity;

  /** Location code unique within the warehouse (e.g. `A-01-03` for aisle / rack / shelf). */
  @Column({ type: 'varchar', length: 64, name: 'code' })
  code!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'name' })
  name?: string | null;

  @Column({ type: 'text', nullable: true, name: 'description' })
  description?: string | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
