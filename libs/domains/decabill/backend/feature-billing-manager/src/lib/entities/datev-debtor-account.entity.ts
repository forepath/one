import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('billing_datev_debtor_accounts')
@Unique('uq_billing_datev_debtor_accounts_tenant_user', ['tenantId', 'userId'])
@Unique('uq_billing_datev_debtor_accounts_tenant_debtor', ['tenantId', 'debtorNumber'])
export class DatevDebtorAccountEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'int', name: 'debtor_number' })
  debtorNumber!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
