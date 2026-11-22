import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Console override of one controller setting (environment variable); the value is encrypted at rest. */
@Entity('controller_settings_overrides')
@Index('IDX_controller_settings_overrides_setting_key_unique', ['settingKey'], { unique: true })
export class ControllerSettingsOverrideEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

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
