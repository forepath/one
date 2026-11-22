import { BadRequestException, NotFoundException } from '@nestjs/common';

import { GLOBAL_SETTINGS_SCOPE, SettingDefinition, SettingsOverrideRecord } from './setting-definition.types';
import { SettingsOverridesManager, SettingsOverridesStore } from './settings-overrides.manager';
import { resetSettingsOverridesRegistryForTests, resolveSettingValue } from './settings-overrides.registry';

const DEFINITIONS: SettingDefinition[] = [
  { key: 'MANAGER_TENANT', category: 'c', type: 'integer', scope: 'tenant', min: 0 },
  { key: 'MANAGER_GLOBAL', category: 'c', type: 'boolean', scope: 'global' },
];

class MemoryStore implements SettingsOverridesStore {
  rows: SettingsOverrideRecord[] = [];

  async findAll(): Promise<SettingsOverrideRecord[]> {
    return [...this.rows];
  }

  async upsert(record: SettingsOverrideRecord): Promise<void> {
    await this.remove(record.scopeKey, record.settingKey);
    this.rows.push(record);
  }

  async remove(scopeKey: string, settingKey: string): Promise<boolean> {
    const before = this.rows.length;

    this.rows = this.rows.filter((row) => !(row.scopeKey === scopeKey && row.settingKey === settingKey));

    return this.rows.length !== before;
  }
}

describe('SettingsOverridesManager', () => {
  let store: MemoryStore;
  let manager: SettingsOverridesManager;

  beforeEach(async () => {
    resetSettingsOverridesRegistryForTests();
    delete process.env.MANAGER_TENANT;
    store = new MemoryStore();
    manager = new SettingsOverridesManager(store, DEFINITIONS);
    await manager.start(60_000);
  });

  afterEach(() => manager.stop());

  it('stores normalized overrides per level and resets them', async () => {
    await manager.upsert('global', 'MANAGER_TENANT', ' 4 ');
    await manager.upsert('tenant', 'MANAGER_TENANT', '9', 'acme');

    expect(store.rows).toEqual([
      { scopeKey: GLOBAL_SETTINGS_SCOPE, settingKey: 'MANAGER_TENANT', value: '4' },
      { scopeKey: 'acme', settingKey: 'MANAGER_TENANT', value: '9' },
    ]);
    expect(resolveSettingValue('MANAGER_TENANT', 'acme')).toBe('9');
    expect(resolveSettingValue('MANAGER_TENANT', 'other')).toBe('4');

    const view = await manager.reset('tenant', 'MANAGER_TENANT', 'acme');

    expect(view).toMatchObject({ hasOverride: false, inheritedValue: '4', effectiveSource: 'global' });
    expect(resolveSettingValue('MANAGER_TENANT', 'acme')).toBe('4');
  });

  it('rejects unknown keys, invalid values and tenant overrides of global settings', async () => {
    await expect(manager.upsert('global', 'NOPE', 'x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(manager.upsert('global', 'MANAGER_TENANT', '-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(manager.upsert('tenant', 'MANAGER_GLOBAL', 'true', 'acme')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(manager.upsert('tenant', 'MANAGER_TENANT', '1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(manager.upsert('tenant', 'MANAGER_TENANT', '1', GLOBAL_SETTINGS_SCOPE)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.rows).toEqual([]);
  });

  it('picks up rows written by other processes on list', async () => {
    store.rows.push({ scopeKey: GLOBAL_SETTINGS_SCOPE, settingKey: 'MANAGER_GLOBAL', value: 'true' });

    const views = await manager.list('global');

    expect(views.find((view) => view.key === 'MANAGER_GLOBAL')).toMatchObject({ value: 'true', hasOverride: true });
    expect(resolveSettingValue('MANAGER_GLOBAL')).toBe('true');
  });
});
