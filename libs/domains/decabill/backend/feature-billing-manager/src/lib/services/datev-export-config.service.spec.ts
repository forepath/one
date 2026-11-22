import {
  GLOBAL_SETTINGS_SCOPE,
  registerSettingDefinitions,
  resetSettingsOverridesRegistryForTests,
  setSettingsOverride,
} from '@forepath/shared/backend/util-settings-overrides';

import { BILLING_SETTINGS } from '../constants/billing-settings.catalog';

import { DatevExportConfigService } from './datev-export-config.service';
import { TenantsGlobalViewsConfigService } from './tenants-global-views-config.service';

describe('DatevExportConfigService', () => {
  const originalEnv = process.env;

  function createService(): DatevExportConfigService {
    const globalViews = new TenantsGlobalViewsConfigService();

    globalViews.onModuleInit();

    return new DatevExportConfigService(globalViews);
  }

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TENANTS_ALLOW_GLOBAL_VIEWS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('isEnabled defaults to true and respects false', () => {
    const service = createService();

    service.onModuleInit();
    expect(service.isEnabled()).toBe(true);

    process.env.BILLING_DATEV_EXPORT_ENABLED = 'false';
    const disabled = createService();

    disabled.onModuleInit();
    expect(disabled.isEnabled()).toBe(false);
  });

  it('getUnifiedExportAllowedTenants defaults to default tenant', () => {
    const service = createService();

    service.onModuleInit();
    expect(service.getUnifiedExportAllowedTenants()).toEqual(['default']);
  });

  it('parses unified export allowlist from TENANTS_ALLOW_GLOBAL_VIEWS', () => {
    process.env.TENANTS_ALLOW_GLOBAL_VIEWS = 'default,acme';
    const service = createService();

    service.onModuleInit();
    expect(service.getUnifiedExportAllowedTenants()).toEqual(['default', 'acme']);
  });

  it('resolveForTenant returns null when consultant/client missing', () => {
    delete process.env.BILLING_DATEV_CONSULTANT_NUMBER;
    delete process.env.BILLING_DATEV_CLIENT_NUMBER;
    const service = createService();

    service.onModuleInit();
    expect(service.resolveForTenant('default')).toBeNull();
  });

  it('resolveForTenant returns config when required env is set', () => {
    process.env.BILLING_DATEV_CONSULTANT_NUMBER = '1234567';
    process.env.BILLING_DATEV_CLIENT_NUMBER = '56789';
    const service = createService();

    service.onModuleInit();
    const config = service.resolveForTenant('default');

    expect(config?.consultantNumber).toBe('1234567');
    expect(config?.clientNumber).toBe('56789');
    expect(config?.expenseAccountStandard).toBeTruthy();
    expect(config?.creditorAccountStart).toBeGreaterThan(0);
    expect(config?.creditorAccountEnd).toBeGreaterThan(config?.creditorAccountStart ?? 0);
  });

  it('isUnifiedExportEnabled respects unified export flag', () => {
    process.env.BILLING_DATEV_UNIFIED_EXPORT_ENABLED = 'true';
    const service = createService();

    service.onModuleInit();
    expect(service.isUnifiedExportEnabled()).toBe(true);
  });

  it('isUnifiedExportAllowedForTenant checks allowlist', () => {
    process.env.BILLING_DATEV_UNIFIED_EXPORT_ENABLED = 'true';
    process.env.TENANTS_ALLOW_GLOBAL_VIEWS = 'default,acme';
    const service = createService();

    service.onModuleInit();
    expect(service.isUnifiedExportAllowedForTenant('acme')).toBe(true);
    expect(service.isUnifiedExportAllowedForTenant('other')).toBe(false);
  });

  it('returns export timezone and cron defaults', () => {
    const service = createService();

    service.onModuleInit();
    expect(service.getExportTimezone()).toBe('Europe/Berlin');
    expect(service.getExportCronPattern()).toBe('0 0 1 * *');
  });

  it('falls back when BILLING_DATEV_EXPORT_CRON is empty', () => {
    process.env.BILLING_DATEV_EXPORT_CRON = '';
    const service = createService();

    service.onModuleInit();
    expect(service.getExportCronPattern()).toBe('0 0 1 * *');
  });

  it('applies tenant overrides from JSON config', () => {
    process.env.BILLING_DATEV_CONSULTANT_NUMBER = '1111111';
    process.env.BILLING_DATEV_CLIENT_NUMBER = '22222';
    process.env.BILLING_DATEV_TENANT_CONFIG = JSON.stringify({
      acme: { consultantNumber: '9999999', clientNumber: '33333', chartOfAccounts: 'SKR04' },
    });
    const service = createService();

    service.onModuleInit();
    const config = service.resolveForTenant('acme');

    expect(config?.consultantNumber).toBe('9999999');
    expect(config?.clientNumber).toBe('33333');
    expect(config?.chartOfAccounts).toBe('SKR04');
  });

  it('returns null when export is disabled', () => {
    process.env.BILLING_DATEV_EXPORT_ENABLED = 'false';
    process.env.BILLING_DATEV_CONSULTANT_NUMBER = '1234567';
    process.env.BILLING_DATEV_CLIENT_NUMBER = '56789';
    const service = createService();

    service.onModuleInit();
    expect(service.resolveForTenant('default')).toBeNull();
  });

  it('resolveUnified delegates to unified tenant config', () => {
    process.env.BILLING_DATEV_CONSULTANT_NUMBER = '1234567';
    process.env.BILLING_DATEV_CLIENT_NUMBER = '56789';
    process.env.BILLING_DATEV_TENANT_CONFIG = JSON.stringify({
      unified: { consultantNumber: '7654321', clientNumber: '98765' },
    });
    const service = createService();

    service.onModuleInit();
    expect(service.resolveUnified()?.consultantNumber).toBe('7654321');
  });

  describe('console overrides', () => {
    beforeEach(() => {
      resetSettingsOverridesRegistryForTests();
      registerSettingDefinitions(BILLING_SETTINGS);
      process.env.BILLING_DATEV_CONSULTANT_NUMBER = 'env-consultant';
      process.env.BILLING_DATEV_CLIENT_NUMBER = 'env-client';
      process.env.BILLING_DATEV_TENANT_CONFIG = JSON.stringify({ acme: { clientNumber: 'json-client' } });
    });

    afterAll(() => resetSettingsOverridesRegistryForTests());

    it('resolves tenant override, then tenant JSON, then all-tenants override, then environment', () => {
      const service = createService();

      service.onModuleInit();
      expect(service.resolveForTenant('acme')).toMatchObject({
        consultantNumber: 'env-consultant',
        clientNumber: 'json-client',
      });

      setSettingsOverride(GLOBAL_SETTINGS_SCOPE, 'BILLING_DATEV_CONSULTANT_NUMBER', 'global-consultant');
      setSettingsOverride('acme', 'BILLING_DATEV_CLIENT_NUMBER', 'acme-client');
      setSettingsOverride('acme', 'BILLING_DATEV_CHART_OF_ACCOUNTS', 'SKR04');
      setSettingsOverride('acme', 'BILLING_DATEV_ACCOUNT_LENGTH', '5');
      setSettingsOverride('acme', 'BILLING_DATEV_EXPORT_INCLUDE_DOCUMENTS', 'false');

      expect(service.resolveForTenant('acme')).toMatchObject({
        consultantNumber: 'global-consultant',
        clientNumber: 'acme-client',
        chartOfAccounts: 'SKR04',
        accountLength: 5,
        includeDocuments: false,
      });
      expect(service.resolveForTenant('beta')).toMatchObject({
        consultantNumber: 'global-consultant',
        clientNumber: 'env-client',
        chartOfAccounts: 'SKR03',
      });
    });

    it('ignores tenant overrides in the consolidated export but keeps the operator tenant JSON', () => {
      const service = createService();

      service.onModuleInit();
      setSettingsOverride('acme', 'BILLING_DATEV_REVENUE_ACCOUNT_STANDARD', '1234');
      setSettingsOverride('acme', 'BILLING_DATEV_CLIENT_NUMBER', 'acme-client');

      expect(service.resolveForTenant('acme')?.revenueAccountStandard).toBe('1234');
      expect(service.resolveForTenant('acme', { consolidated: true })).toMatchObject({
        clientNumber: 'json-client',
        revenueAccountStandard: '8400',
      });
      expect(service.resolveForTenant('acme')?.clientNumber).toBe('acme-client');
    });

    it('ignores tenant overrides of a tenant called unified for the consolidated export', () => {
      const service = createService();

      service.onModuleInit();
      setSettingsOverride('unified', 'BILLING_DATEV_CLIENT_NUMBER', 'hijacked');

      expect(service.resolveForTenant('unified')?.clientNumber).toBe('env-client');
    });
  });
});
