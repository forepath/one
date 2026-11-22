import { runWithTenantId } from '@forepath/shared/backend/util-http-context';

import { GLOBAL_SETTINGS_SCOPE, SettingDefinition } from './setting-definition.types';
import {
  createSettingsScopedCache,
  describeSettings,
  getEnvironmentSettingValue,
  getSettingsOverridesVersion,
  getTenantSettingOverride,
  installSettingsOverridesEnv,
  registerSettingDefinitions,
  removeSettingsOverride,
  replaceSettingsOverrides,
  resetSettingsOverridesRegistryForTests,
  resolveSettingSource,
  resolveSettingValue,
  setSettingsOverride,
} from './settings-overrides.registry';

const DEFINITIONS: SettingDefinition[] = [
  { key: 'TEST_TENANT_SETTING', category: 'c', type: 'string', scope: 'tenant' },
  { key: 'TEST_GLOBAL_SETTING', category: 'c', type: 'integer', scope: 'global', defaultValue: '5' },
  { key: 'TEST_SECRET_SETTING', category: 'c', type: 'secret', scope: 'tenant' },
];

describe('settings overrides registry', () => {
  beforeAll(() => {
    installSettingsOverridesEnv();
  });

  beforeEach(() => {
    resetSettingsOverridesRegistryForTests();
    registerSettingDefinitions(DEFINITIONS);
    process.env.TEST_TENANT_SETTING = 'env-tenant';
    process.env.TEST_GLOBAL_SETTING = '1';
    process.env.TEST_SECRET_SETTING = 'env-secret';
    process.env.TEST_UNREGISTERED = 'plain';
  });

  afterEach(() => {
    delete process.env.TEST_TENANT_SETTING;
    delete process.env.TEST_GLOBAL_SETTING;
    delete process.env.TEST_SECRET_SETTING;
    delete process.env.TEST_UNREGISTERED;
  });

  it('resolves tenant override, then global override, then environment', () => {
    expect(process.env.TEST_TENANT_SETTING).toBe('env-tenant');

    setSettingsOverride(GLOBAL_SETTINGS_SCOPE, 'TEST_TENANT_SETTING', 'global');
    expect(process.env.TEST_TENANT_SETTING).toBe('global');
    expect(runWithTenantId('acme', () => process.env.TEST_TENANT_SETTING)).toBe('global');

    setSettingsOverride('acme', 'TEST_TENANT_SETTING', 'acme-value');
    expect(runWithTenantId('acme', () => process.env.TEST_TENANT_SETTING)).toBe('acme-value');
    expect(runWithTenantId('other', () => process.env.TEST_TENANT_SETTING)).toBe('global');
    expect(process.env.TEST_TENANT_SETTING).toBe('global');
    expect(resolveSettingValue('TEST_TENANT_SETTING', 'acme')).toBe('acme-value');
    expect(resolveSettingSource('TEST_TENANT_SETTING', 'acme')).toBe('tenant');
    expect(resolveSettingSource('TEST_TENANT_SETTING', 'other')).toBe('global');
  });

  it('lets the environment apply again after a reset without mutating it', () => {
    setSettingsOverride(GLOBAL_SETTINGS_SCOPE, 'TEST_GLOBAL_SETTING', '9');
    expect(process.env.TEST_GLOBAL_SETTING).toBe('9');
    expect(getEnvironmentSettingValue('TEST_GLOBAL_SETTING')).toBe('1');

    removeSettingsOverride(GLOBAL_SETTINGS_SCOPE, 'TEST_GLOBAL_SETTING');
    expect(process.env.TEST_GLOBAL_SETTING).toBe('1');
    expect(resolveSettingSource('TEST_GLOBAL_SETTING')).toBe('environment');
  });

  it('ignores tenant overrides of global settings and unknown keys', () => {
    setSettingsOverride('acme', 'TEST_GLOBAL_SETTING', '7');
    setSettingsOverride(GLOBAL_SETTINGS_SCOPE, 'TEST_UNREGISTERED', 'x');
    replaceSettingsOverrides([
      { scopeKey: 'acme', settingKey: 'TEST_GLOBAL_SETTING', value: '8' },
      { scopeKey: GLOBAL_SETTINGS_SCOPE, settingKey: 'TEST_UNREGISTERED', value: 'y' },
    ]);

    expect(runWithTenantId('acme', () => process.env.TEST_GLOBAL_SETTING)).toBe('1');
    expect(getTenantSettingOverride('TEST_GLOBAL_SETTING', 'acme')).toBeUndefined();
    expect(process.env.TEST_UNREGISTERED).toBe('plain');
  });

  it('reflects overrides in has / keys / spread for the current tenant', () => {
    delete process.env.TEST_TENANT_SETTING;
    expect('TEST_TENANT_SETTING' in process.env).toBe(false);

    setSettingsOverride('acme', 'TEST_TENANT_SETTING', 'acme-value');
    runWithTenantId('acme', () => {
      expect('TEST_TENANT_SETTING' in process.env).toBe(true);
      expect(Object.keys(process.env)).toContain('TEST_TENANT_SETTING');
      expect({ ...process.env }.TEST_TENANT_SETTING).toBe('acme-value');
    });
    expect('TEST_TENANT_SETTING' in process.env).toBe(false);
  });

  it('passes writes through to the environment', () => {
    process.env.TEST_UNREGISTERED = 'changed';
    expect(getEnvironmentSettingValue('TEST_UNREGISTERED')).toBe('changed');
  });

  it('bumps the version only on changes', () => {
    replaceSettingsOverrides([{ scopeKey: GLOBAL_SETTINGS_SCOPE, settingKey: 'TEST_GLOBAL_SETTING', value: '2' }]);
    const version = getSettingsOverridesVersion();

    replaceSettingsOverrides([{ scopeKey: GLOBAL_SETTINGS_SCOPE, settingKey: 'TEST_GLOBAL_SETTING', value: '2' }]);
    expect(getSettingsOverridesVersion()).toBe(version);

    replaceSettingsOverrides([]);
    expect(getSettingsOverridesVersion()).toBeGreaterThan(version);
  });

  it('caches derived values per tenant and version', () => {
    const compute = jest.fn(() => process.env.TEST_TENANT_SETTING);
    const cache = createSettingsScopedCache(compute);

    expect(cache.get()).toBe('env-tenant');
    expect(cache.get()).toBe('env-tenant');
    expect(compute).toHaveBeenCalledTimes(1);

    setSettingsOverride('acme', 'TEST_TENANT_SETTING', 'acme-value');
    expect(runWithTenantId('acme', () => cache.get())).toBe('acme-value');
    expect(cache.get()).toBe('env-tenant');
    expect(compute).toHaveBeenCalledTimes(3);
  });

  describe('describeSettings', () => {
    it('describes the global level with environment inheritance', () => {
      setSettingsOverride(GLOBAL_SETTINGS_SCOPE, 'TEST_GLOBAL_SETTING', '3');

      const [tenantSetting, globalSetting] = describeSettings(DEFINITIONS, 'global');

      expect(globalSetting).toMatchObject({
        key: 'TEST_GLOBAL_SETTING',
        value: '3',
        hasOverride: true,
        inheritedValue: '1',
        inheritedSource: 'environment',
        effectiveSource: 'global',
        defaultValue: '5',
      });
      expect(tenantSetting).toMatchObject({ value: null, hasOverride: false, effectiveSource: 'environment' });
    });

    it('describes the tenant level with tenant scoped settings only and global inheritance', () => {
      setSettingsOverride(GLOBAL_SETTINGS_SCOPE, 'TEST_TENANT_SETTING', 'global');
      setSettingsOverride('acme', 'TEST_TENANT_SETTING', 'acme-value');

      const views = describeSettings(DEFINITIONS, 'tenant', 'acme');

      expect(views.map((view) => view.key)).toEqual(['TEST_TENANT_SETTING', 'TEST_SECRET_SETTING']);
      expect(views[0]).toMatchObject({
        value: 'acme-value',
        inheritedValue: 'global',
        inheritedSource: 'global',
        effectiveSource: 'tenant',
      });
    });

    it('hides inherited values when asked to', () => {
      setSettingsOverride(GLOBAL_SETTINGS_SCOPE, 'TEST_TENANT_SETTING', 'operator');

      const [view] = describeSettings(DEFINITIONS, 'tenant', 'acme', { revealInherited: false });

      expect(view).toMatchObject({ inheritedValue: null, hasInheritedValue: true, inheritedSource: 'global' });
    });

    it('never returns secret values', () => {
      setSettingsOverride('acme', 'TEST_SECRET_SETTING', 'tenant-secret');

      const secret = describeSettings(DEFINITIONS, 'tenant', 'acme')[1];

      expect(secret).toMatchObject({
        sensitive: true,
        value: null,
        hasOverride: true,
        inheritedValue: null,
        hasInheritedValue: true,
      });
      expect(JSON.stringify(secret)).not.toContain('secret-');
      expect(JSON.stringify(secret)).not.toContain('env-secret');
    });

    it('tells the console the size limit of image settings only', () => {
      const [image, text] = describeSettings(
        [
          { key: 'TEST_IMAGE', category: 'c', type: 'image', scope: 'tenant' },
          { key: 'TEST_TEXT', category: 'c', type: 'text', scope: 'tenant', maxLength: 10 },
        ],
        'global',
      );

      expect(image.maxLength).toBe(65536);
      expect(text.maxLength).toBeUndefined();
    });
  });
});
