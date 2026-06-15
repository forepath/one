import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { WorkspaceConfigurationSettingKey } from '../constants/workspace-configuration-settings';

@Entity('workspace_configuration_overrides')
@Index('IDX_workspace_configuration_overrides_setting_key_unique', ['settingKey'], { unique: true })
export class WorkspaceConfigurationOverrideEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'setting_key' })
  settingKey!: WorkspaceConfigurationSettingKey;

  @Column({
    type: 'text',
    name: 'value',
    transformer: createAes256GcmTransformer(),
  })
  value!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
