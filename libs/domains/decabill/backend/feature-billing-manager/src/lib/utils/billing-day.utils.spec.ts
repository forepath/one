import { getEffectiveBillingDay, getTodayBillingDay } from './billing-day.utils';

describe('billing-day.utils', () => {
  describe('getEffectiveBillingDay', () => {
    it('returns explicit billing day when set (1-28)', () => {
      const createdAt = new Date('2024-01-15T00:00:00Z');

      expect(getEffectiveBillingDay(createdAt, 10)).toBe(10);
      expect(getEffectiveBillingDay(createdAt, 1)).toBe(1);
      expect(getEffectiveBillingDay(createdAt, 28)).toBe(28);
    });

    it('returns registration day when billingDayOfMonth is null', () => {
      const createdAt = new Date('2024-01-10T00:00:00Z');

      expect(getEffectiveBillingDay(createdAt, null)).toBe(10);
      expect(getEffectiveBillingDay(createdAt, undefined)).toBe(10);
    });

    it('caps registration day at 28 when day > 28', () => {
      const createdAt = new Date('2024-01-31T00:00:00Z');

      expect(getEffectiveBillingDay(createdAt, null)).toBe(28);
      const created29 = new Date('2024-01-29T00:00:00Z');

      expect(getEffectiveBillingDay(created29, undefined)).toBe(28);
    });

    it('uses registration day when billingDayOfMonth is 0 or out of range', () => {
      const createdAt = new Date('2024-01-15T00:00:00Z');

      expect(getEffectiveBillingDay(createdAt, 0)).toBe(15);
      expect(getEffectiveBillingDay(createdAt, 29)).toBe(15);
    });
  });

  describe('getTodayBillingDay', () => {
    it('returns day of month for today, capped at 28', () => {
      const day = getTodayBillingDay();

      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(28);
    });
  });
});
