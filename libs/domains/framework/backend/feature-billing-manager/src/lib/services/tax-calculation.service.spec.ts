import { TaxCategory } from '../constants/tax-category.constants';

import { TaxCalculationService } from './tax-calculation.service';
import { TaxRateConfigService } from './tax-rate-config.service';

describe('TaxCalculationService', () => {
  const taxRateConfig = new TaxRateConfigService();
  const service = new TaxCalculationService(taxRateConfig);

  beforeEach(() => {
    process.env.BILLING_TAX_RATE_STANDARD = '19';
    process.env.BILLING_TAX_RATE_REDUCED = '7';
  });

  it('computes totals with standard and reduced rates', () => {
    const result = service.computeLines([
      { description: 'Standard item', quantity: 1, unitPriceNet: 100, taxCategory: TaxCategory.STANDARD },
      { description: 'Reduced item', quantity: 1, unitPriceNet: 50, taxCategory: TaxCategory.REDUCED },
    ]);

    expect(result.subtotalNet).toBe(150);
    expect(result.taxTotal).toBe(22.5);
    expect(result.totalGross).toBe(172.5);
    expect(result.taxBreakdown).toHaveLength(2);
  });
});
