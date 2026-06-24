import { TENANTS_ALLOW_DEFAULT_ENV, parseConfiguredTenants, isConfiguredTenant } from '@forepath/shared/backend';

import { BillingTenantService } from './billing-tenant.service';

describe('BillingTenantService', () => {
  const originalTenants = process.env['TENANTS'];
  const originalAllowDefault = process.env[TENANTS_ALLOW_DEFAULT_ENV];
  const originalBillingFrontendUrl = process.env['BILLING_FRONTEND_URL'];
  const originalTenantFrontendUrls = process.env['TENANT_FRONTEND_URLS'];

  afterEach(() => {
    if (originalTenants === undefined) {
      delete process.env['TENANTS'];
    } else {
      process.env['TENANTS'] = originalTenants;
    }

    if (originalAllowDefault === undefined) {
      delete process.env[TENANTS_ALLOW_DEFAULT_ENV];
    } else {
      process.env[TENANTS_ALLOW_DEFAULT_ENV] = originalAllowDefault;
    }

    if (originalBillingFrontendUrl === undefined) {
      delete process.env['BILLING_FRONTEND_URL'];
    } else {
      process.env['BILLING_FRONTEND_URL'] = originalBillingFrontendUrl;
    }

    if (originalTenantFrontendUrls === undefined) {
      delete process.env['TENANT_FRONTEND_URLS'];
    } else {
      process.env['TENANT_FRONTEND_URLS'] = originalTenantFrontendUrls;
    }
  });

  it('returns configured tenants including default', () => {
    process.env['TENANTS'] = 'alpha,beta';
    const service = new BillingTenantService();

    expect(service.getConfiguredTenants()).toEqual(['default', 'alpha', 'beta']);
  });

  it('validates tenant membership', () => {
    process.env['TENANTS'] = 'alpha';
    const service = new BillingTenantService();

    expect(service.isValidTenant('default')).toBe(true);
    expect(service.isValidTenant('alpha')).toBe(true);
    expect(service.isValidTenant('missing')).toBe(false);
    expect(parseConfiguredTenants()).toEqual(['default', 'alpha']);
    expect(isConfiguredTenant('alpha', parseConfiguredTenants())).toBe(true);
  });

  it('excludes default tenant when TENANTS_ALLOW_DEFAULT is false', () => {
    process.env['TENANTS'] = 'alpha,beta';
    process.env[TENANTS_ALLOW_DEFAULT_ENV] = 'false';
    const service = new BillingTenantService();

    expect(service.getConfiguredTenants()).toEqual(['alpha', 'beta']);
    expect(service.isValidTenant('default')).toBe(false);
    expect(service.isValidTenant('alpha')).toBe(true);
  });

  it('resolves frontend url per tenant', () => {
    process.env['BILLING_FRONTEND_URL'] = 'http://localhost:4500';
    process.env['TENANT_FRONTEND_URLS'] = 'alpha=https://billing.alpha.example';
    const service = new BillingTenantService();

    expect(service.getFrontendUrlForTenant('default')).toBe('http://localhost:4500');
    expect(service.getFrontendUrlForTenant('alpha')).toBe('https://billing.alpha.example');
  });
});
