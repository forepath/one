import { computeLineTotalsFromRate, rateForTaxCategory } from './tax-preview.utils';

describe('tax-preview.utils', () => {
  it('selects reduced or standard rate', () => {
    const rates = { standard: 19, reduced: 7 };

    expect(rateForTaxCategory(rates, 'standard')).toBe(19);
    expect(rateForTaxCategory(rates, 'reduced')).toBe(7);
  });

  it('computes line totals from resolved rate', () => {
    expect(computeLineTotalsFromRate(2, 50, 0)).toEqual({
      net: 100,
      tax: 0,
      gross: 100,
      taxRate: 0,
    });
    expect(computeLineTotalsFromRate(1, 100, 21)).toEqual({
      net: 100,
      tax: 21,
      gross: 121,
      taxRate: 21,
    });
  });
});
