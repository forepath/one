import {
  GLOBAL_SETTINGS_SCOPE,
  SettingsOverrideRecord,
  SettingsOverridesStore,
} from '@forepath/shared/backend/util-settings-overrides';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ControllerSettingsOverrideEntity } from '../entities/controller-settings-override.entity';

/** Agenstra has no tenants: every override is deployment-wide. */
@Injectable()
export class ControllerSettingsOverridesRepository implements SettingsOverridesStore {
  constructor(
    @InjectRepository(ControllerSettingsOverrideEntity)
    private readonly repository: Repository<ControllerSettingsOverrideEntity>,
  ) {}

  async findAll(): Promise<SettingsOverrideRecord[]> {
    const rows = await this.repository.find();

    return rows.map(toControllerSettingsOverrideRecord);
  }

  async upsert(record: SettingsOverrideRecord, updatedByUserId?: string | null): Promise<void> {
    if (record.scopeKey !== GLOBAL_SETTINGS_SCOPE) {
      throw new Error('Agent controller settings are deployment-wide only');
    }

    const existing = await this.repository.findOne({ where: { settingKey: record.settingKey } });

    if (existing) {
      existing.value = record.value;
      existing.updatedByUserId = updatedByUserId ?? null;
      await this.repository.save(existing);

      return;
    }

    await this.repository.save(
      this.repository.create({
        settingKey: record.settingKey,
        value: record.value,
        updatedByUserId: updatedByUserId ?? null,
      }),
    );
  }

  async remove(scopeKey: string, settingKey: string): Promise<boolean> {
    if (scopeKey !== GLOBAL_SETTINGS_SCOPE) {
      return false;
    }

    const result = await this.repository.delete({ settingKey });

    return (result.affected ?? 0) > 0;
  }
}

export function toControllerSettingsOverrideRecord(row: ControllerSettingsOverrideEntity): SettingsOverrideRecord {
  return { scopeKey: GLOBAL_SETTINGS_SCOPE, settingKey: row.settingKey, value: row.value };
}
