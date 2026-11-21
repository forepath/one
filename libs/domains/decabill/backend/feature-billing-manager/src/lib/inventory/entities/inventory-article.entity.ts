import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { TaxCategory } from '../../constants/tax-category.constants';

/** Article master data. The article number is allocated like invoice numbers and doubles as internal barcode. */
@Entity('billing_inventory_articles')
@Index('uq_billing_inventory_articles_number_scope_number', ['numberScope', 'articleNumber'], { unique: true })
export class InventoryArticleEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  /** `ART-{nnnnnn}`; internal identifier, rendered as Code 128. */
  @Column({ type: 'varchar', length: 32, name: 'article_number' })
  articleNumber!: string;

  /** `__shared__` when TENANTS_SHARED_NUMBERS is enabled; otherwise the tenant id. */
  @Column({ type: 'varchar', length: 64, name: 'number_scope', default: '__shared__' })
  numberScope!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'text', nullable: true, name: 'description' })
  description?: string | null;

  /** GTIN-8 / UPC-A / EAN-13 / GTIN-14 with valid check digit. */
  @Column({ type: 'varchar', length: 14, nullable: true, name: 'ean' })
  ean?: string | null;

  @Column({ type: 'varchar', length: 16, default: 'piece', name: 'unit' })
  unit!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'manufacturer' })
  manufacturer?: string | null;

  /** Manufacturer part number (MPN). */
  @Column({ type: 'varchar', length: 128, nullable: true, name: 'manufacturer_part_number' })
  manufacturerPartNumber?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'supplier_id' })
  supplierId?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, name: 'supplier_article_number' })
  supplierArticleNumber?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true, name: 'purchase_price_net' })
  purchasePriceNet?: number | string | null;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true, name: 'sales_price_net' })
  salesPriceNet?: number | string | null;

  @Column({ type: 'varchar', length: 10, default: 'EUR', name: 'currency' })
  currency!: string;

  @Column({ type: 'varchar', length: 32, default: TaxCategory.STANDARD, name: 'tax_category' })
  taxCategory!: TaxCategory;

  /** Reorder point: total stock at or below this is reported as low. */
  @Column({ type: 'decimal', precision: 14, scale: 3, nullable: true, name: 'reorder_point' })
  reorderPoint?: number | string | null;

  @Column({ type: 'decimal', precision: 14, scale: 3, nullable: true, name: 'reorder_quantity' })
  reorderQuantity?: number | string | null;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true, name: 'weight_kg' })
  weightKg?: number | string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, name: 'length_cm' })
  lengthCm?: number | string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, name: 'width_cm' })
  widthCm?: number | string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, name: 'height_cm' })
  heightCm?: number | string | null;

  /** Customs tariff number (HS / CN code). */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'hs_code' })
  hsCode?: string | null;

  @Column({ type: 'varchar', length: 2, nullable: true, name: 'country_of_origin' })
  countryOfOrigin?: string | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive!: boolean;

  /**
   * Every unit carries a serial number: putaways register serial numbers, all other movements name the units they
   * move. Only switchable while the article has no stock and no open lendings.
   */
  @Column({ type: 'boolean', default: false, name: 'serial_tracking' })
  serialTracking!: boolean;

  /** Moving weighted average unit cost of the stock on hand (accounting valuation). */
  @Column({ type: 'decimal', precision: 14, scale: 4, nullable: true, name: 'average_cost' })
  averageCost?: number | string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
