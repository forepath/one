import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WorkspaceConfigurationSettingKey } from '../constants/workspace-configuration-settings';
import { WorkspaceConfigurationOverrideEntity } from '../entities/workspace-configuration-override.entity';

@Injectable()
export class WorkspaceConfigurationOverridesRepository {
  constructor(
    @InjectRepository(WorkspaceConfigurationOverrideEntity)
    private readonly repository: Repository<WorkspaceConfigurationOverrideEntity>,
  ) {}

  async findAll(): Promise<WorkspaceConfigurationOverrideEntity[]> {
    return await this.repository.find({ order: { settingKey: 'ASC' } });
  }

  async findBySettingKey(
    settingKey: WorkspaceConfigurationSettingKey,
  ): Promise<WorkspaceConfigurationOverrideEntity | null> {
    return await this.repository.findOne({ where: { settingKey } });
  }

  async upsert(
    settingKey: WorkspaceConfigurationSettingKey,
    value: string,
  ): Promise<WorkspaceConfigurationOverrideEntity> {
    const existing = await this.findBySettingKey(settingKey);

    if (existing) {
      existing.value = value;

      return await this.repository.save(existing);
    }

    return await this.repository.save(this.repository.create({ settingKey, value }));
  }

  async deleteBySettingKey(settingKey: WorkspaceConfigurationSettingKey): Promise<number> {
    const result = await this.repository.delete({ settingKey });

    return result.affected ?? 0;
  }
}
