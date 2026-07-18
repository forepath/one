import { getMinCheckoutPaymentAmount } from './payment-amount.constants';

describe('getMinCheckoutPaymentAmount', () => {
  it('falls back to 1 when unset', () => {
    expect(getMinCheckoutPaymentAmount(undefined)).toBe(1);
    expect(getMinCheckoutPaymentAmount('')).toBe(1);
    expect(getMinCheckoutPaymentAmount('   ')).toBe(1);
  });

  it('falls back to 1 when invalid', () => {
    expect(getMinCheckoutPaymentAmount('abc')).toBe(1);
    expect(getMinCheckoutPaymentAmount('0')).toBe(1);
    expect(getMinCheckoutPaymentAmount('-2')).toBe(1);
  });

  it('parses a positive amount from env', () => {
    expect(getMinCheckoutPaymentAmount('1')).toBe(1);
    expect(getMinCheckoutPaymentAmount('2.5')).toBe(2.5);
  });
});
