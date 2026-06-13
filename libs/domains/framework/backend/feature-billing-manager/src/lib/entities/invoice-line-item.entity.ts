import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { TaxCategory } from '../constants/tax-category.constants';

import { InvoiceEntity } from './invoice.entity';

@Entity('billing_invoice_line_items')
export class InvoiceLineItemEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId!: string;

  @ManyToOne(() => InvoiceEntity, (invoice) => invoice.lineItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice?: InvoiceEntity;

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
}
