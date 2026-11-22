import { runWithTenantId } from '@forepath/shared/backend';
import {
  GLOBAL_SETTINGS_SCOPE,
  resetSettingsOverridesRegistryForTests,
  resolveSettingValue,
  SettingsOverrideRecord,
} from '@forepath/shared/backend/util-settings-overrides';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';

import { BillingSettingsOverridesRepository } from '../repositories/billing-settings-overrides.repository';

import { BillingSettingsService } from './billing-settings.service';
import { BillingTenantService } from './billing-tenant.service';
import { TenantsGlobalViewsConfigService } from './tenants-global-views-config.service';

describe('BillingSettingsService', () => {
  let rows: SettingsOverrideRecord[];
  let service: BillingSettingsService;
  const repository = {
    findAll: jest.fn(async () => [...rows]),
    upsert: jest.fn(async (record: SettingsOverrideRecord) => {
      rows = rows.filter((row) => !(row.scopeKey === record.scopeKey && row.settingKey === record.settingKey));
      rows.push(record);
    }),
    remove: jest.fn(async (scopeKey: string, settingKey: string) => {
      rows = rows.filter((row) => !(row.scopeKey === scopeKey && row.settingKey === settingKey));

      return true;
    }),
  };
  const globalViews = {
    isGlobalViewsAllowedForTenant: jest.fn((tenantId: string) => tenantId === 'default'),
  };
  const tenants = {
    getConfiguredTenants: jest.fn(() => ['default', 'acme', 'beta']),
    isValidTenant: jest.fn((tenantId: string) => ['default', 'acme', 'beta'].includes(tenantId)),
  };

  beforeEach(async () => {
    resetSettingsOverridesRegistryForTests();
    rows = [];
    jest.clearAllMocks();
    service = new BillingSettingsService(
      repository as unknown as BillingSettingsOverridesRepository,
      globalViews as unknown as TenantsGlobalViewsConfigService,
      tenants as unknown as BillingTenantService,
    );
    await service.onModuleInit();
  });

  afterEach(() => service.onModuleDestroy());

  describe('global-view tenant', () => {
    const asOperator = <T>(fn: () => T): T => runWithTenantId('default', fn);

    it('defaults to the level of all tenants and lists every configured tenant', async () => {
      const overview = await asOperator(() => service.getOverview());

      expect(overview).toMatchObject({
        level: 'global',
        tenantId: null,
        homeTenantId: 'default',
        canManageGlobal: true,
        viewableTenants: ['default', 'acme', 'beta'],
      });
      expect(overview.settings.some((setting) => setting.key === 'BILLING_SCHEDULER_INTERVAL')).toBe(true);
    });

    it('configures all tenants and any configured tenant', async () => {
      await asOperator(() => service.upsert('BILLING_ISSUER_NAME', 'Operator GmbH', 'global', undefined));
      await asOperator(() => service.upsert('BILLING_ISSUER_NAME', 'Acme Ltd', 'tenant', 'acme'));

      expect(rows).toEqual([
        { scopeKey: GLOBAL_SETTINGS_SCOPE, settingKey: 'BILLING_ISSUER_NAME', value: 'Operator GmbH' },
        { scopeKey: 'acme', settingKey: 'BILLING_ISSUER_NAME', value: 'Acme Ltd' },
      ]);
      expect(resolveSettingValue('BILLING_ISSUER_NAME', 'acme')).toBe('Acme Ltd');
      expect(resolveSettingValue('BILLING_ISSUER_NAME', 'beta')).toBe('Operator GmbH');

      const tenantView = await asOperator(() => service.getOverview('tenant', 'acme'));

      expect(tenantView.tenantId).toBe('acme');
      expect(tenantView.settings.every((setting) => setting.scope === 'tenant')).toBe(true);
      expect(tenantView.settings.find((setting) => setting.key === 'BILLING_ISSUER_NAME')).toMatchObject({
        value: 'Acme Ltd',
        inheritedValue: 'Operator GmbH',
        inheritedSource: 'global',
      });
    });

    it('rejects unknown tenants', async () => {
      await expect(
        asOperator(() => service.upsert('BILLING_ISSUER_NAME', 'x', 'tenant', 'ghost')),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('rejects tenant overrides of deployment-wide settings', async () => {
      await expect(
        asOperator(() => service.upsert('BILLING_SCHEDULER_INTERVAL', '1000', 'tenant', 'acme')),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('regular tenant', () => {
    const asAcme = <T>(fn: () => T): T => runWithTenantId('acme', fn);

    it('sees and edits the own tenant only', async () => {
      const overview = await asAcme(() => service.getOverview());

      expect(overview).toMatchObject({
        level: 'tenant',
        tenantId: 'acme',
        canManageGlobal: false,
        viewableTenants: ['acme'],
      });

      await asAcme(() => service.upsert('SMTP_PORT', '2525', undefined, undefined));
      expect(rows).toEqual([{ scopeKey: 'acme', settingKey: 'SMTP_PORT', value: '2525' }]);
    });

    it('cannot reach the level of all tenants', async () => {
      await expect(asAcme(() => service.getOverview('global'))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(asAcme(() => service.upsert('SMTP_HOST', 'evil', 'global', undefined))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(asAcme(() => service.reset('SMTP_HOST', 'global', undefined))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('cannot configure other tenants', async () => {
      await expect(asAcme(() => service.getOverview('tenant', 'beta'))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(asAcme(() => service.upsert('SMTP_HOST', 'x', 'tenant', 'beta'))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(asAcme(() => service.reset('SMTP_HOST', 'tenant', 'default'))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repository.upsert).not.toHaveBeenCalled();
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it('does not see the deployment values it inherits', async () => {
      rows.push({ scopeKey: GLOBAL_SETTINGS_SCOPE, settingKey: 'BILLING_ISSUER_IBAN', value: 'DE00OPERATORIBAN' });

      const overview = await asAcme(() => service.getOverview());

      expect(JSON.stringify(overview)).not.toContain('DE00OPERATORIBAN');
      expect(overview.settings.find((setting) => setting.key === 'BILLING_ISSUER_IBAN')).toMatchObject({
        inheritedValue: null,
        hasInheritedValue: true,
        inheritedSource: 'global',
      });

      const operatorView = await runWithTenantId('default', () => service.getOverview('tenant', 'acme'));

      expect(operatorView.settings.find((setting) => setting.key === 'BILLING_ISSUER_IBAN')?.inheritedValue).toBe(
        'DE00OPERATORIBAN',
      );
    });

    it('never receives secret values', async () => {
      rows.push({ scopeKey: GLOBAL_SETTINGS_SCOPE, settingKey: 'SMTP_PASSWORD', value: 'operator-secret' });
      await asAcme(() => service.upsert('SMTP_PASSWORD', 'acme-secret', undefined, undefined));

      const overview = await asAcme(() => service.getOverview());

      expect(JSON.stringify(overview)).not.toContain('operator-secret');
      expect(JSON.stringify(overview)).not.toContain('acme-secret');
      expect(overview.settings.find((setting) => setting.key === 'SMTP_PASSWORD')).toMatchObject({
        hasOverride: true,
        hasInheritedValue: true,
        value: null,
        inheritedValue: null,
      });
    });

    it('resets the tenant override so the next layer applies again', async () => {
      rows.push({ scopeKey: GLOBAL_SETTINGS_SCOPE, settingKey: 'BILLING_TAX_RATE_STANDARD', value: '20' });
      await asAcme(() => service.upsert('BILLING_TAX_RATE_STANDARD', '21', undefined, undefined));
      expect(resolveSettingValue('BILLING_TAX_RATE_STANDARD', 'acme')).toBe('21');

      const view = await asAcme(() => service.reset('BILLING_TAX_RATE_STANDARD', undefined, undefined));

      expect(view).toMatchObject({
        hasOverride: false,
        inheritedValue: null,
        hasInheritedValue: true,
        inheritedSource: 'global',
        effectiveSource: 'global',
      });
      expect(resolveSettingValue('BILLING_TAX_RATE_STANDARD', 'acme')).toBe('20');
    });
  });
});
