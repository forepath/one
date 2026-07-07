import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

@Entity('billing_service_types')
@Unique('uq_billing_service_types_tenant_key', ['tenantId', 'key'])
export class ServiceTypeEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 100, name: 'key' })
  key!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'text', nullable: true, name: 'description' })
  description?: string;

  @Column({ type: 'varchar', length: 100, name: 'provider' })
  provider!: string;

  @Column({ type: 'jsonb', name: 'config_schema', default: () => "'{}'::jsonb" })
  configSchema!: Record<string, unknown>;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ type: 'boolean', name: 'disallow_statutory_withdrawal', default: false })
  disallowStatutoryWithdrawal!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
