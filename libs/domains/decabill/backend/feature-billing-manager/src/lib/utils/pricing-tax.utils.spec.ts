import { TaxCategory } from '../constants/tax-category.constants';

import { enrichPricingWithStandardTax } from './pricing-tax.utils';

describe('pricing-tax.utils', () => {
  it('adds standard VAT totals to pricing result', () => {
    const taxCalculationService = {
      computeLines: jest.fn().mockReturnValue({
        taxTotal: 3.7,
        totalGross: 23.19,
        lines: [{ taxRate: 19 }],
      }),
    };

    const result = enrichPricingWithStandardTax(
      { basePrice: 19.49, marginPercent: 0, marginFixed: 0, totalPrice: 19.49 },
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
