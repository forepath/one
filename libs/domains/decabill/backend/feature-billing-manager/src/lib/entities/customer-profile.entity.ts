import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { CustomerType } from '../constants/customer-type.constants';
import { CustomerTrustLevel } from '../trust-score/trust-score.types';
import { VatIdValidationSource, VatIdValidationStatus } from '../constants/vat-id-validation.constants';

@Entity('billing_customer_profiles')
export class CustomerProfileEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id', unique: true })
  userId!: string;

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

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'stripe_customer_id' })
  stripeCustomerId?: string;

  @Column({ type: 'boolean', name: 'auto_billing_enabled', default: false })
  autoBillingEnabled!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'default_payment_method_external_id' })
  defaultPaymentMethodExternalId?: string;

  @Column({ type: 'integer', nullable: true, name: 'trust_score' })
  trustScore?: number | null;

  @Column({ type: 'varchar', length: 16, nullable: true, name: 'trust_level' })
  trustLevel?: CustomerTrustLevel | null;

  @Column({ type: 'timestamp', nullable: true, name: 'trust_score_updated_at' })
  trustScoreUpdatedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
