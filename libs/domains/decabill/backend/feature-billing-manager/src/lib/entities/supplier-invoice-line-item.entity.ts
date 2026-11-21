import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { TaxCategory } from '../constants/tax-category.constants';

import { SupplierInvoiceEntity } from './supplier-invoice.entity';

@Entity('billing_supplier_invoice_line_items')
export class SupplierInvoiceLineItemEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId!: string;

  @ManyToOne(() => SupplierInvoiceEntity, (invoice) => invoice.lineItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice?: SupplierInvoiceEntity;

  @Column({ type: 'int', default: 0, name: 'position' })
  position!: number;

  @Column({ type: 'varchar', length: 500, name: 'description' })
  description!: string;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 1, name: 'quantity' })
  quantity!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'unit_price_net' })
  unitPriceNet!: number;

  @Column({
    type: 'enum',
    enum: TaxCategory,
    enumName: 'tax_category_enum',
    default: TaxCategory.STANDARD,
    name: 'tax_category',
  })
  taxCategory!: TaxCategory;

  @Column({ type: 'decimal', precision: 8, scale: 4, name: 'tax_rate' })
  taxRate!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'line_net' })
  lineNet!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'line_tax' })
  lineTax!: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, name: 'line_gross' })
  lineGross!: number;

  /** Account assignment (Kontierung) overriding the supplier default; account number of the active chart. */
  @Column({ type: 'varchar', length: 20, nullable: true, name: 'ledger_account_number' })
  ledgerAccountNumber?: string | null;

  /** Capitalize this line as a fixed asset instead of expensing it. */
  @Column({ type: 'boolean', name: 'capitalize_as_asset', default: false })
  capitalizeAsAsset!: boolean;

  /** Useful life in months for capitalized lines. */
  @Column({ type: 'int', nullable: true, name: 'asset_useful_life_months' })
  assetUsefulLifeMonths?: number | null;

  /** Stock article received with this line (moving-average valuation of the putaway). */
  @Column({ type: 'uuid', nullable: true, name: 'inventory_article_id' })
  inventoryArticleId?: string | null;
}
