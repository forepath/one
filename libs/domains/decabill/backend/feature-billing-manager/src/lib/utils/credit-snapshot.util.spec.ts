import { creditFromInvoiceSnapshot } from './credit-snapshot.util';

describe('creditFromInvoiceSnapshot', () => {
  it('uses the rate of the largest positive line and caps at the invoiced net', () => {
    expect(
      creditFromInvoiceSnapshot(
        { subtotalNet: 80, resolvedTaxRate: 7 },
        [
          { lineNet: 100, taxRate: 19 },
          { lineNet: -20, taxRate: 19 },
          { lineNet: 5, taxRate: 7 },
        ],
        120,
      ),
    ).toEqual({ net: 80, tax: 15.2, gross: 95.2, taxRate: 19 });
  });

  it('falls back to the invoice rate and never credits negative amounts', () => {
    expect(creditFromInvoiceSnapshot({ subtotalNet: 50, resolvedTaxRate: 0 }, [], 10)).toEqual({
      net: 10,
      tax: 0,
      gross: 10,
      taxRate: 0,
    });
    expect(creditFromInvoiceSnapshot({ subtotalNet: 50, resolvedTaxRate: 19 }, [], -5).net).toBe(0);
  });
});
