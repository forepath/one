import { TaxCategory } from '../constants/tax-category.constants';

import { TaxRateConfigService } from './tax-rate-config.service';

describe('TaxRateConfigService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns standard rate from env', () => {
    process.env.BILLING_TAX_RATE_STANDARD = '19';
    const service = new TaxRateConfigService();

    expect(service.resolveRate(TaxCategory.STANDARD)).toBe(19);
  });

  it('returns reduced rate from env', () => {
    process.env.BILLING_TAX_RATE_REDUCED = '7';
    const service = new TaxRateConfigService();

    expect(service.resolveRate(TaxCategory.REDUCED)).toBe(7);
  });

  it('falls back when env is invalid', () => {
    process.env.BILLING_TAX_RATE_STANDARD = 'invalid';
    const service = new TaxRateConfigService();

    expect(service.resolveRate(TaxCategory.STANDARD)).toBe(19);
  });
});
