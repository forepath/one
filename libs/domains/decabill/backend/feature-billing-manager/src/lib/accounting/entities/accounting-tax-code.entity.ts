import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { TaxCodeKind } from '../constants/accounting.constants';

/**
 * VAT treatment of a posting line: rate, VAT account(s), the VAT return boxes for base and tax, and the DATEV
 * BU key used when the line is not on an automatic account.
 */
@Entity('billing_accounting_tax_codes')
@Index('uq_billing_accounting_tax_codes_chart_code', ['chartId', 'code'], { unique: true })
export class AccountingTaxCodeEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'chart_id' })
  chartId!: string;

  /** e.g. `OUT_STD`, `OUT_RED`, `OUT_EU_RC`, `OUT_OSS`, `OUT_EXPORT`, `IN_STD`, `RC_EU_SERVICES`. */
  @Column({ type: 'varchar', length: 32, name: 'code' })
  code!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'varchar', length: 16, name: 'kind' })
  kind!: TaxCodeKind;

  /** Percent, e.g. `19.0000`; `null` = rate taken from the document line (OSS destination rates). */
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, name: 'rate' })
  rate?: number | string | null;

  /** VAT account (output VAT for OUTPUT, input VAT for INPUT and REVERSE_CHARGE). */
  @Column({ type: 'uuid', nullable: true, name: 'account_id' })
  accountId?: string | null;

  /** Output VAT account of a reverse-charge code (the payable side). */
  @Column({ type: 'uuid', nullable: true, name: 'reverse_account_id' })
  reverseAccountId?: string | null;

  /** VAT return box receiving the net base (e.g. DE `81`, `21`, `46`; FR CA3 `A1`; UK `6`). */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'base_box' })
  baseBox?: string | null;

  /** VAT return box receiving the tax (e.g. DE `66`, `47`; UK `1`/`4`). */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'tax_box' })
  taxBox?: string | null;

  /** Second tax box of a reverse-charge code (input VAT side, e.g. DE `67`). */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'reverse_tax_box' })
  reverseTaxBox?: string | null;

  /** Also reported in the EC sales list (ZM / état récapitulatif). */
  @Column({ type: 'boolean', name: 'ec_sales_list', default: false })
  ecSalesList!: boolean;

  /** Reported through the OSS return instead of the domestic VAT return. */
  @Column({ type: 'boolean', name: 'oss', default: false })
  oss!: boolean;

  @Column({ type: 'varchar', length: 4, nullable: true, name: 'datev_bu_key' })
  datevBuKey?: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
