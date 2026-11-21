import { createJsonAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

import { CustomerType } from '../constants/customer-type.constants';
import { VatIdValidationSource, VatIdValidationStatus } from '../constants/vat-id-validation.constants';

@Entity('billing_supplier_profiles')
@Unique('uq_billing_supplier_profiles_number_scope_number', ['numberScope', 'supplierNumber'])
export class SupplierProfileEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 50, name: 'supplier_number' })
  supplierNumber!: string;

  /** `__shared__` when TENANTS_SHARED_NUMBERS is enabled; otherwise the tenant id. */
  @Column({ type: 'varchar', length: 64, name: 'number_scope', default: '__shared__' })
  numberScope!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'first_name' })
  firstName?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'last_name' })
  lastName?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'company' })
  company?: string;

  @Column({
    type: 'varchar',
    length: 16,
    nullable: true,
    name: 'customer_type',
  })
  customerType?: CustomerType | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'vat_id' })
  vatId?: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'vat_id_validation_status',
    default: VatIdValidationStatus.NONE,
  })
  vatIdValidationStatus!: VatIdValidationStatus;

  @Column({ type: 'timestamp', nullable: true, name: 'vat_id_validated_at' })
  vatIdValidatedAt?: Date | null;

  @Column({
    type: 'varchar',
    length: 16,
    nullable: true,
    name: 'vat_id_validation_source',
  })
  vatIdValidationSource?: VatIdValidationSource | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'address_line_1' })
  addressLine1?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'address_line_2' })
  addressLine2?: string;

  @Column({ type: 'varchar', length: 30, nullable: true, name: 'postal_code' })
  postalCode?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'city' })
  city?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'state' })
  state?: string;

  @Column({ type: 'varchar', length: 2, nullable: true, name: 'country' })
  country?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'email' })
  email?: string;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'phone' })
  phone?: string;

  /** Admin-only key/value map for external-system linkage; encrypted at rest via AES-256-GCM. */
  @Column({
    type: 'text',
    name: 'custom_data',
    nullable: true,
    transformer: createJsonAes256GcmTransformer(),
  })
  customData!: Record<string, string>;

  /** Default expense account number for this supplier's invoices (accounting; chart-independent by number). */
  @Column({ type: 'varchar', length: 20, nullable: true, name: 'default_expense_account_number' })
  defaultExpenseAccountNumber?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
