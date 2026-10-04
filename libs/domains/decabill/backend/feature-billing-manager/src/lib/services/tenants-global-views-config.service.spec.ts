import { TenantsGlobalViewsConfigService } from './tenants-global-views-config.service';

describe('TenantsGlobalViewsConfigService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TENANTS_ALLOW_GLOBAL_VIEWS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults to default tenant when env unset', () => {
    const service = new TenantsGlobalViewsConfigService();

    service.onModuleInit();
    expect(service.getAllowedTenants()).toEqual(['default']);
    expect(service.isGlobalViewsAllowedForTenant('default')).toBe(true);
    expect(service.isGlobalViewsAllowedForTenant('acme')).toBe(false);
  });

  it('parses CSV allowlist from TENANTS_ALLOW_GLOBAL_VIEWS', () => {
    process.env.TENANTS_ALLOW_GLOBAL_VIEWS = 'default,acme';
    const service = new TenantsGlobalViewsConfigService();

    service.onModuleInit();
    expect(service.getAllowedTenants()).toEqual(['default', 'acme']);
    expect(service.isGlobalViewsAllowedForTenant('acme')).toBe(true);
    expect(service.isGlobalViewsAllowedForTenant('other')).toBe(false);
  });
});
