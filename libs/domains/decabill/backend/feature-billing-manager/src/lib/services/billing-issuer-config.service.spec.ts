import { BillingIssuerConfigService } from './billing-issuer-config.service';

describe('BillingIssuerConfigService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('loads issuer config from environment on init', () => {
    process.env.BILLING_ISSUER_NAME = 'Acme GmbH';
    process.env.BILLING_ISSUER_VAT_ID = 'DE123';
    process.env.BILLING_ISSUER_ADDRESS_LINE1 = 'Street 1';
    process.env.BILLING_ISSUER_POSTAL_CODE = '10115';
    process.env.BILLING_ISSUER_CITY = 'Berlin';
    process.env.BILLING_ISSUER_COUNTRY = 'DE';
    process.env.BILLING_ISSUER_BANK = 'Example Bank';
    process.env.BILLING_ISSUER_IBAN = 'DE89370400440532013000';
    process.env.BILLING_ISSUER_BIC = 'COBADEFFXXX';

    const service = new BillingIssuerConfigService();

    service.onModuleInit();

    expect(service.getConfig()).toEqual({
      name: 'Acme GmbH',
      vatId: 'DE123',
      addressLine1: 'Street 1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
      email: undefined,
      bank: 'Example Bank',
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
    });
  });

  it('assertConfigured throws when required fields are missing', () => {
    const service = new BillingIssuerConfigService();

    service.onModuleInit();

    expect(() => service.assertConfigured()).toThrow('Billing issuer is not configured');
  });

  it('assertConfigured passes when required fields are set', () => {
    process.env.BILLING_ISSUER_NAME = 'Acme';
    process.env.BILLING_ISSUER_VAT_ID = 'DE1';
    process.env.BILLING_ISSUER_ADDRESS_LINE1 = 'A';
    process.env.BILLING_ISSUER_POSTAL_CODE = '1';
    process.env.BILLING_ISSUER_CITY = 'B';

    const service = new BillingIssuerConfigService();

    service.onModuleInit();

    expect(() => service.assertConfigured()).not.toThrow();
  });
});
