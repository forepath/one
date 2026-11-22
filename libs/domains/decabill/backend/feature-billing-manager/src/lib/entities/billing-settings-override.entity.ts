import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

/**
 * Console override of one billing manager setting (environment variable).
 * `scope_key` is `__global__` for the override of all tenants, otherwise the tenant id. The value is encrypted at rest.
 */
@Entity('billing_settings_overrides')
@Unique('uq_billing_settings_overrides_scope_key_setting_key', ['scopeKey', 'settingKey'])
export class BillingSettingsOverrideEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'scope_key' })
  scopeKey!: string;

  @Column({ type: 'varchar', length: 128, name: 'setting_key' })
  settingKey!: string;

  @Column({ type: 'text', name: 'value', transformer: createAes256GcmTransformer() })
  value!: string;

  @Column({ type: 'uuid', name: 'updated_by_user_id', nullable: true })
  updatedByUserId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
