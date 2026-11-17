import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** A physical (or logical) stock location holding storage compartments. Tenant-scoped. */
@Entity('billing_inventory_warehouses')
@Index('uq_billing_inventory_warehouses_tenant_code', ['tenantId', 'code'], { unique: true })
export class InventoryWarehouseEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  /** Short unique code within the tenant (e.g. `WH-MAIN`), printed on documents. */
  @Column({ type: 'varchar', length: 32, name: 'code' })
  code!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'text', nullable: true, name: 'description' })
  description?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'address_line1' })
  addressLine1?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'address_line2' })
  addressLine2?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'postal_code' })
  postalCode?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'city' })
  city?: string | null;

  @Column({ type: 'varchar', length: 2, nullable: true, name: 'country' })
  country?: string | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
