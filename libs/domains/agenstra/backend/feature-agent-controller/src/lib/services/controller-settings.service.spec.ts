import {
  GLOBAL_SETTINGS_SCOPE,
  resetSettingsOverridesRegistryForTests,
  resolveSettingValue,
  SettingsOverrideRecord,
} from '@forepath/shared/backend/util-settings-overrides';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { CONTROLLER_SETTINGS, CONTROLLER_SETTINGS_CATEGORIES } from '../constants/controller-settings.catalog';
import { ControllerSettingsOverridesRepository } from '../repositories/controller-settings-overrides.repository';

import { ControllerSettingsService } from './controller-settings.service';

describe('ControllerSettingsService', () => {
  let rows: SettingsOverrideRecord[];
  let service: ControllerSettingsService;
  const repository = {
    findAll: jest.fn(async () => [...rows]),
    upsert: jest.fn(async (record: SettingsOverrideRecord) => {
      rows = rows.filter((row) => row.settingKey !== record.settingKey);
      rows.push(record);
    }),
    remove: jest.fn(async (_scope: string, settingKey: string) => {
      rows = rows.filter((row) => row.settingKey !== settingKey);

      return true;
    }),
  };

  beforeEach(async () => {
    resetSettingsOverridesRegistryForTests();
    rows = [];
    process.env.AGENT_TASKS_MAX_PER_AGENT = '25';
    service = new ControllerSettingsService(repository as unknown as ControllerSettingsOverridesRepository);
    await service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    delete process.env.AGENT_TASKS_MAX_PER_AGENT;
  });

  it('uses only known categories and global scope', () => {
    for (const setting of CONTROLLER_SETTINGS) {
      expect(CONTROLLER_SETTINGS_CATEGORIES).toContain(setting.category);
      expect(setting.scope).toBe('global');
    }

    expect(new Set(CONTROLLER_SETTINGS.map((setting) => setting.key)).size).toBe(CONTROLLER_SETTINGS.length);
  });

  it('does not expose infrastructure or security settings', () => {
    const keys = CONTROLLER_SETTINGS.map((setting) => setting.key);

    for (const excluded of [
      'ENCRYPTION_KEY',
      'JWT_SECRET',
      'DB_PASSWORD',
      'STATIC_API_KEY',
      'CORS_ORIGIN',
      'CLIENT_ENDPOINT_ALLOWED_HOSTS',
      'CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST',
      'DYNAMIC_PROVISIONING_PROVIDERS',
      'EMBEDDING_DIMENSIONS',
    ]) {
      expect(keys).not.toContain(excluded);
    }
  });

  it('overrides, describes and resets settings', async () => {
    await service.upsert('AGENT_TASKS_MAX_PER_AGENT', '40', 'user-1');

    expect(rows).toEqual([{ scopeKey: GLOBAL_SETTINGS_SCOPE, settingKey: 'AGENT_TASKS_MAX_PER_AGENT', value: '40' }]);
    expect(resolveSettingValue('AGENT_TASKS_MAX_PER_AGENT')).toBe('40');

    const overview = await service.getOverview();

    expect(overview).toMatchObject({ level: 'global', tenantId: null, canManageGlobal: true, viewableTenants: [] });
    expect(overview.settings.find((setting) => setting.key === 'AGENT_TASKS_MAX_PER_AGENT')).toMatchObject({
      value: '40',
      inheritedValue: '25',
      inheritedSource: 'environment',
    });

    await service.reset('AGENT_TASKS_MAX_PER_AGENT');
    expect(resolveSettingValue('AGENT_TASKS_MAX_PER_AGENT')).toBe('25');
  });

  it('validates keys and values', async () => {
    await expect(service.upsert('JWT_SECRET', 'x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.upsert('AGENT_TASKS_MAX_PER_AGENT', '0')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.upsert('OPENCODE_MCP_REGISTRY_BASE_URL', 'http://internal')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
