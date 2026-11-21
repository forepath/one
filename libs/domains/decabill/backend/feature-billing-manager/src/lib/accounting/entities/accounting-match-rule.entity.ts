import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Learned reconciliation rule: a counterparty IBAN (or remittance pattern) belongs to a customer / supplier, or is
 * booked directly to an account (bank fees, rent …). Created when admins confirm matches.
 */
@Entity('billing_accounting_match_rules')
@Index('uq_billing_accounting_match_rules', ['kind', 'pattern'], { unique: true })
export class AccountingMatchRuleEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  /** `iban` (exact counterparty IBAN) or `text` (case-insensitive substring of remittance/name). */
  @Column({ type: 'varchar', length: 8, name: 'kind' })
  kind!: 'iban' | 'text';

  @Column({ type: 'varchar', length: 128, name: 'pattern' })
  pattern!: string;

  @Column({ type: 'varchar', length: 16, name: 'target_type' })
  targetType!: 'customer' | 'supplier' | 'account';

  /** User id, supplier id or account number. */
  @Column({ type: 'varchar', length: 64, name: 'target_id' })
  targetId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'tax_code' })
  taxCode?: string | null;

  @Column({ type: 'int', name: 'hits', default: 0 })
  hits!: number;

  @Column({ type: 'uuid', nullable: true, name: 'created_by_user_id' })
  createdByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
