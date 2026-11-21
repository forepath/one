import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type FixedAssetMethod = 'straight_line' | 'immediate' | 'pool';
export type FixedAssetStatus = 'active' | 'fully_depreciated' | 'disposed';

/** Fixed asset register entry (Anlagenverzeichnis). */
@Entity('billing_accounting_fixed_assets')
export class AccountingFixedAssetEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'tenant_id' })
  tenantId?: string | null;

  /** `AST-{nnnnn}`. */
  @Column({ type: 'varchar', length: 32, name: 'asset_number' })
  assetNumber!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'date', name: 'acquisition_date' })
  acquisitionDate!: string;

  /** Net acquisition cost (functional currency). */
  @Column({ type: 'decimal', precision: 14, scale: 2, name: 'acquisition_cost' })
  acquisitionCost!: number | string;

  @Column({ type: 'varchar', length: 16, name: 'method' })
  method!: FixedAssetMethod;

  @Column({ type: 'int', name: 'useful_life_months' })
  usefulLifeMonths!: number;

  /** Asset account number (balance sheet). */
  @Column({ type: 'varchar', length: 20, name: 'asset_account_number' })
  assetAccountNumber!: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, name: 'residual_value', default: 0 })
  residualValue!: number | string;

  @Column({ type: 'decimal', precision: 14, scale: 2, name: 'accumulated_depreciation', default: 0 })
  accumulatedDepreciation!: number | string;

  /** Last month (YYYY-MM) depreciated. */
  @Column({ type: 'varchar', length: 7, nullable: true, name: 'depreciated_through' })
  depreciatedThrough?: string | null;

  @Column({ type: 'varchar', length: 24, name: 'status', default: 'active' })
  status!: FixedAssetStatus;

  @Column({ type: 'uuid', nullable: true, name: 'supplier_invoice_id' })
  supplierInvoiceId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'supplier_invoice_line_id' })
  supplierInvoiceLineId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'inventory_serial_unit_id' })
  inventorySerialUnitId?: string | null;

  @Column({ type: 'date', nullable: true, name: 'disposal_date' })
  disposalDate?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true, name: 'disposal_proceeds' })
  disposalProceeds?: number | string | null;

  @Column({ type: 'text', nullable: true, name: 'note' })
  note?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
