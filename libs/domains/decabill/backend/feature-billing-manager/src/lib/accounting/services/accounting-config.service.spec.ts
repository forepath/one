import { AccountingConfigService } from './accounting-config.service';

describe('AccountingConfigService', () => {
  const env = { ...process.env };
  const issuer = {
    getConfig: jest.fn(() => ({
      name: 'Forepath GmbH',
      addressLine1: 'Str. 1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
      vatId: 'DE1',
    })),
  };

  afterEach(() => {
    process.env = { ...env };
  });

  function build(vars: Record<string, string | undefined>): AccountingConfigService {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }

    const service = new AccountingConfigService(issuer as never);

    service.onModuleInit();

    return service;
  }

  it('is disabled unless BILLING_ACCOUNTING_ENABLED and a complete issuer are set', () => {
    expect(build({ BILLING_ACCOUNTING_ENABLED: undefined, BILLING_ISSUER_COUNTRY: 'DE' }).isEnabled()).toBe(false);
    expect(
      build({ BILLING_ACCOUNTING_ENABLED: 'true', BILLING_ISSUER_COUNTRY: undefined }).getMissingCorePrerequisites(),
    ).toEqual(['BILLING_ISSUER_COUNTRY']);
    expect(build({ BILLING_ACCOUNTING_ENABLED: 'true', BILLING_ISSUER_COUNTRY: 'DE' }).isEnabled()).toBe(true);
  });

  it('selects the national profile and reports outputs whose identifiers are missing', () => {
    const service = build({
      BILLING_ACCOUNTING_ENABLED: 'true',
      BILLING_ISSUER_COUNTRY: 'DE',
      BILLING_ISSUER_TAX_NUMBER: undefined,
    });

    expect(service.getConfig().profile.country).toBe('DE');
    expect(service.getConfig().defaultChartTemplate).toBe('DE-SKR03');
    expect(service.isFeatureAvailable('DE-USTVA')).toBe(false);
    expect(service.getFeatureAvailability().find((f) => f.key === 'DE-USTVA')?.missing).toEqual([
      'BILLING_ISSUER_TAX_NUMBER',
    ]);
    expect(service.isFeatureAvailable('DE-ZM')).toBe(true);
  });

  it('falls back to the generic profile and rejects unknown templates / non-https ECB urls', () => {
    const service = build({
      BILLING_ACCOUNTING_ENABLED: 'true',
      BILLING_ISSUER_COUNTRY: 'DE',
      BILLING_ACCOUNTING_COUNTRY: 'ZZ',
      BILLING_ACCOUNTING_CHART_TEMPLATE: 'DE-SKR04',
      BILLING_ACCOUNTING_ECB_RATES_URL: 'http://evil.example/feed',
    });

    expect(service.getConfig().profile.country).toBe('*');
    expect(service.getConfig().defaultChartTemplate).not.toBe('DE-SKR04');
    expect(service.getConfig().ecbRatesUrl).toBe('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');
  });

  it('derives the start date from the fiscal-year start month', () => {
    const service = build({
      BILLING_ACCOUNTING_ENABLED: 'true',
      BILLING_ISSUER_COUNTRY: 'DE',
      BILLING_ACCOUNTING_FISCAL_YEAR_START_MONTH: '7',
      BILLING_ACCOUNTING_START_DATE: undefined,
    });

    expect(service.getConfig().startDate).toMatch(/^\d{4}-07-01$/);
    expect(service.fiscalYearStartFor('2027-03-15')).toBe('2026-07-01');
  });
});
