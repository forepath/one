import { invoiceSummaryItems } from './invoice-totals';

describe('invoiceSummaryItems', () => {
  const totals = { subtotalNet: 100, taxTotal: 19, totalGross: 119, currency: 'EUR' };

  it('shows the balance due', () => {
    const balance = invoiceSummaryItems({ ...totals, balanceDue: 59 }, 'en-US').find((item) => item.key === 'balance');

    expect(balance?.label).toBe('Balance due');
    expect(balance?.value).toContain('59.00');
  });

  it('shows a negative balance as customer credit', () => {
    const balance = invoiceSummaryItems({ ...totals, balanceDue: -20 }, 'en-US').find((item) => item.key === 'balance');

    expect(balance?.label).toBe('Customer credit');
    expect(balance?.value).toContain('20.00');
    expect(balance?.value).not.toContain('-');
  });
});
