import { SettingsOverrideRecord, SettingsOverridesStore } from '@forepath/shared/backend/util-settings-overrides';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BillingSettingsOverrideEntity } from '../entities/billing-settings-override.entity';

/** Settings overrides across all tenants (the registry resolves per tenant; reads are deliberately unscoped). */
@Injectable()
export class BillingSettingsOverridesRepository implements SettingsOverridesStore {
  constructor(
    @InjectRepository(BillingSettingsOverrideEntity)
    private readonly repository: Repository<BillingSettingsOverrideEntity>,
  ) {}

  async findAll(): Promise<SettingsOverrideRecord[]> {
    const rows = await this.repository.find();

    return rows.map(toBillingSettingsOverrideRecord);
  }

  async upsert(record: SettingsOverrideRecord, updatedByUserId?: string | null): Promise<void> {
    await this.repository.upsert(
      {
        scopeKey: record.scopeKey,
        settingKey: record.settingKey,
        value: record.value,
        updatedByUserId: updatedByUserId ?? null,
      },
      { conflictPaths: ['scopeKey', 'settingKey'] },
    );
  }

  async remove(scopeKey: string, settingKey: string): Promise<boolean> {
    const result = await this.repository.delete({ scopeKey, settingKey });

    return (result.affected ?? 0) > 0;
  }
}

export function toBillingSettingsOverrideRecord(row: BillingSettingsOverrideEntity): SettingsOverrideRecord {
  return { scopeKey: row.scopeKey, settingKey: row.settingKey, value: row.value };
}
