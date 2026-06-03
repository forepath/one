import { formatAmount, formatDate, toAmount } from './invoice-pdf-amount.util';

describe('invoice-pdf-amount.util', () => {
  describe('toAmount', () => {
    it('coerces decimal strings from the database', () => {
      expect(toAmount('100.0000')).toBe(100);
    });

    it('returns 0 for invalid values', () => {
      expect(toAmount(null)).toBe(0);
      expect(toAmount('invalid')).toBe(0);
    });
  });

  describe('formatAmount', () => {
    it('formats numbers with two decimal places', () => {
      expect(formatAmount(119)).toBe('119.00');
      expect(formatAmount('19.5')).toBe('19.50');
    });
  });

  describe('formatDate', () => {
    it('formats Date instances as ISO date', () => {
      expect(formatDate(new Date('2026-06-01T12:00:00.000Z'))).toBe('2026-06-01');
    });

    it('returns undefined for empty values', () => {
      expect(formatDate(undefined)).toBeUndefined();
    });
  });
});
