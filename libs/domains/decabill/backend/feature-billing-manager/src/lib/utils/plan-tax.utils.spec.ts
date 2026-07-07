import { TaxCategory } from '../constants/tax-category.constants';

import { resolvePlanTaxCategory } from './plan-tax.utils';

describe('plan-tax.utils', () => {
  it('returns standard when taxCategory is undefined', () => {
    expect(resolvePlanTaxCategory({ taxCategory: undefined as unknown as TaxCategory })).toBe(TaxCategory.STANDARD);
  });

  it('returns plan taxCategory when set', () => {
    expect(resolvePlanTaxCategory({ taxCategory: TaxCategory.REDUCED })).toBe(TaxCategory.REDUCED);
  });
});
