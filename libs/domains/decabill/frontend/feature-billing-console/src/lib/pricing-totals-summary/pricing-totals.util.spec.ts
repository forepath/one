import { aggregatePricingTotalsSummaries, buildPricingTotalsSummary } from './pricing-totals.util';

describe('buildPricingTotalsSummary', () => {
  it('builds a single-rate summary', () => {
    expect(buildPricingTotalsSummary({ net: 100, tax: 19, taxRate: 19 })).toEqual({
      subtotalNet: 100,
      taxRows: [{ taxRate: 19, taxAmount: 19 }],
      totalGross: 119,
    });
  });

  it('returns null for invalid inputs', () => {
    expect(buildPricingTotalsSummary({ net: -1, tax: 0, taxRate: 19 })).toBeNull();
    expect(buildPricingTotalsSummary({ net: 10, tax: Number.NaN, taxRate: 19 })).toBeNull();
  });
});

describe('aggregatePricingTotalsSummaries', () => {
  it('aggregates a single rate', () => {
    const result = aggregatePricingTotalsSummaries([
      buildPricingTotalsSummary({ net: 100, tax: 19, taxRate: 19 }),
      buildPricingTotalsSummary({ net: 50, tax: 9.5, taxRate: 19 }),
    ]);

    expect(result).toEqual({
      subtotalNet: 150,
      taxRows: [{ taxRate: 19, taxAmount: 28.5 }],
      totalGross: 178.5,
    });
  });

  it('merges mixed tax rates sorted ascending', () => {
    const result = aggregatePricingTotalsSummaries([
      buildPricingTotalsSummary({ net: 100, tax: 19, taxRate: 19 }),
      buildPricingTotalsSummary({ net: 100, tax: 7, taxRate: 7 }),
    ]);

    expect(result).toEqual({
      subtotalNet: 200,
      taxRows: [
        { taxRate: 7, taxAmount: 7 },
        { taxRate: 19, taxAmount: 19 },
      ],
      totalGross: 226,
    });
  });

  it('returns null when any line is incomplete', () => {
    expect(
      aggregatePricingTotalsSummaries([buildPricingTotalsSummary({ net: 100, tax: 19, taxRate: 19 }), null]),
    ).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(aggregatePricingTotalsSummaries([])).toBeNull();
  });
});
