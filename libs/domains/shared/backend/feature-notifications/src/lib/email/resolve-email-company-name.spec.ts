import { resolveEmailCompanyFrom, resolveEmailCompanyName } from './resolve-email-company-name';

describe('resolveEmailCompanyFrom', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function clearCompanyEnv(): void {
    for (const key of [
      'EMAIL_COMPANY_NAME',
      'EMAIL_COMPANY_ADDRESS_LINE1',
      'EMAIL_COMPANY_POSTAL_CODE',
      'EMAIL_COMPANY_CITY',
      'EMAIL_COMPANY_COUNTRY',
      'EMAIL_COMPANY_VAT_ID',
      'EMAIL_COMPANY_EMAIL',
      'BILLING_ISSUER_NAME',
      'BILLING_ISSUER_ADDRESS_LINE1',
      'BILLING_ISSUER_POSTAL_CODE',
      'BILLING_ISSUER_CITY',
      'BILLING_ISSUER_COUNTRY',
      'BILLING_ISSUER_VAT_ID',
      'BILLING_ISSUER_EMAIL',
    ]) {
      delete process.env[key];
    }
  }

  it('returns undefined when no company name is configured', () => {
    clearCompanyEnv();

    expect(resolveEmailCompanyFrom()).toBeUndefined();
    expect(resolveEmailCompanyName()).toBe('');
  });

  it('prefers EMAIL_COMPANY_* over BILLING_ISSUER_*', () => {
    clearCompanyEnv();
    process.env.EMAIL_COMPANY_NAME = 'Agenstra GmbH';
    process.env.EMAIL_COMPANY_ADDRESS_LINE1 = 'Email St 1';
    process.env.EMAIL_COMPANY_POSTAL_CODE = '11111';
    process.env.EMAIL_COMPANY_CITY = 'Hamburg';
    process.env.EMAIL_COMPANY_COUNTRY = 'DE';
    process.env.EMAIL_COMPANY_VAT_ID = 'DE999';
    process.env.EMAIL_COMPANY_EMAIL = 'hello@agenstra.example';
    process.env.BILLING_ISSUER_NAME = 'Acme GmbH';
    process.env.BILLING_ISSUER_ADDRESS_LINE1 = 'Main St 1';
    process.env.BILLING_ISSUER_POSTAL_CODE = '12345';
    process.env.BILLING_ISSUER_CITY = 'Berlin';
    process.env.BILLING_ISSUER_COUNTRY = 'DE';
    process.env.BILLING_ISSUER_VAT_ID = 'DE123';
    process.env.BILLING_ISSUER_EMAIL = 'billing@acme.example';

    expect(resolveEmailCompanyFrom()).toEqual({
      name: 'Agenstra GmbH',
      lines: ['Email St 1', '11111 Hamburg', 'Germany'],
      vatId: 'DE999',
      email: 'hello@agenstra.example',
    });
  });

  it('falls back to BILLING_ISSUER_* when EMAIL_COMPANY_* is unset', () => {
    clearCompanyEnv();
    process.env.BILLING_ISSUER_NAME = 'Acme GmbH';
    process.env.BILLING_ISSUER_ADDRESS_LINE1 = 'Main St 1';
    process.env.BILLING_ISSUER_POSTAL_CODE = '12345';
    process.env.BILLING_ISSUER_CITY = 'Berlin';
    process.env.BILLING_ISSUER_COUNTRY = 'DE';
    process.env.BILLING_ISSUER_VAT_ID = 'DE123';
    process.env.BILLING_ISSUER_EMAIL = 'billing@acme.example';

    expect(resolveEmailCompanyName()).toBe('Acme GmbH');
    expect(resolveEmailCompanyFrom()).toEqual({
      name: 'Acme GmbH',
      lines: ['Main St 1', '12345 Berlin', 'Germany'],
      vatId: 'DE123',
      email: 'billing@acme.example',
    });
  });
});
