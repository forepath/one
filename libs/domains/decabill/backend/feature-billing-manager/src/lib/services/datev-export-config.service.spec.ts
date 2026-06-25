import { DatevExportConfigService } from './datev-export-config.service';

describe('DatevExportConfigService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('isEnabled defaults to true and respects false', () => {
    const service = new DatevExportConfigService();

    service.onModuleInit();
    expect(service.isEnabled()).toBe(true);

    process.env.BILLING_DATEV_EXPORT_ENABLED = 'false';
    const disabled = new DatevExportConfigService();

    disabled.onModuleInit();
    expect(disabled.isEnabled()).toBe(false);
  });

  it('getUnifiedExportAllowedTenants defaults to default tenant', () => {
    const service = new DatevExportConfigService();

    service.onModuleInit();
    expect(service.getUnifiedExportAllowedTenants()).toEqual(['default']);
  });

  it('parses unified export allowlist from CSV env', () => {
    process.env.BILLING_DATEV_UNIFIED_EXPORT_ALLOWED_TENANTS = 'default,acme';
    const service = new DatevExportConfigService();

    service.onModuleInit();
    expect(service.getUnifiedExportAllowedTenants()).toEqual(['default', 'acme']);
  });

  it('resolveForTenant returns null when consultant/client missing', () => {
    delete process.env.BILLING_DATEV_CONSULTANT_NUMBER;
    delete process.env.BILLING_DATEV_CLIENT_NUMBER;
    const service = new DatevExportConfigService();

    service.onModuleInit();
    expect(service.resolveForTenant('default')).toBeNull();
  });

  it('resolveForTenant returns config when required env is set', () => {
    process.env.BILLING_DATEV_CONSULTANT_NUMBER = '1234567';
    process.env.BILLING_DATEV_CLIENT_NUMBER = '56789';
    const service = new DatevExportConfigService();

    service.onModuleInit();
    const config = service.resolveForTenant('default');

    expect(config?.consultantNumber).toBe('1234567');
    expect(config?.clientNumber).toBe('56789');
  });

  it('isUnifiedExportEnabled respects unified export flag', () => {
    process.env.BILLING_DATEV_UNIFIED_EXPORT_ENABLED = 'true';
    const service = new DatevExportConfigService();

    service.onModuleInit();
    expect(service.isUnifiedExportEnabled()).toBe(true);
  });

  it('isUnifiedExportAllowedForTenant checks allowlist', () => {
    process.env.BILLING_DATEV_UNIFIED_EXPORT_ENABLED = 'true';
    process.env.BILLING_DATEV_UNIFIED_EXPORT_ALLOWED_TENANTS = 'default,acme';
    const service = new DatevExportConfigService();

    service.onModuleInit();
    expect(service.isUnifiedExportAllowedForTenant('acme')).toBe(true);
    expect(service.isUnifiedExportAllowedForTenant('other')).toBe(false);
  });

  it('returns export timezone and cron defaults', () => {
    const service = new DatevExportConfigService();

    service.onModuleInit();
    expect(service.getExportTimezone()).toBe('Europe/Berlin');
    expect(service.getExportCronPattern()).toBe('0 0 1 * *');
  });

  it('applies tenant overrides from JSON config', () => {
    process.env.BILLING_DATEV_CONSULTANT_NUMBER = '1111111';
    process.env.BILLING_DATEV_CLIENT_NUMBER = '22222';
    process.env.BILLING_DATEV_TENANT_CONFIG = JSON.stringify({
      acme: { consultantNumber: '9999999', clientNumber: '33333', chartOfAccounts: 'SKR04' },
    });
    const service = new DatevExportConfigService();

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
    const service = new DatevExportConfigService();

    service.onModuleInit();
    expect(service.resolveForTenant('default')).toBeNull();
  });

  it('resolveUnified delegates to unified tenant config', () => {
    process.env.BILLING_DATEV_CONSULTANT_NUMBER = '1234567';
    process.env.BILLING_DATEV_CLIENT_NUMBER = '56789';
    process.env.BILLING_DATEV_TENANT_CONFIG = JSON.stringify({
      unified: { consultantNumber: '7654321', clientNumber: '98765' },
    });
    const service = new DatevExportConfigService();

    service.onModuleInit();
    expect(service.resolveUnified()?.consultantNumber).toBe('7654321');
  });
});
