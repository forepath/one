import { TaxCategory } from '../constants/tax-category.constants';

import { enrichPricingWithTax } from './pricing-tax.utils';

describe('pricing-tax.utils', () => {
  it('adds VAT totals to pricing result for the given tax category', () => {
    const taxCalculationService = {
      computeLines: jest.fn().mockReturnValue({
        taxTotal: 3.7,
        totalGross: 23.19,
        lines: [{ taxRate: 19 }],
      }),
    };

    const result = enrichPricingWithTax(
      { basePrice: 19.49, marginPercent: 0, marginFixed: 0, totalPrice: 19.49 },
      TaxCategory.STANDARD,
      taxCalculationService as never,
    );

    expect(result).toEqual({
      basePrice: 19.49,
      marginPercent: 0,
      marginFixed: 0,
      totalPrice: 19.49,
      taxTotal: 3.7,
      totalGross: 23.19,
      taxRate: 19,
      taxCategory: TaxCategory.STANDARD,
    });
    expect(taxCalculationService.computeLines).toHaveBeenCalledWith([
      {
        description: 'Subscription period',
        quantity: 1,
        unitPriceNet: 19.49,
        taxCategory: TaxCategory.STANDARD,
      },
    ]);
  });
});
