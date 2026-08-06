import {
  aggregateMeterValues,
  filterEntriesForAttachment,
  isUsageInChargeWindow,
  resolveEffectiveUnitPriceNet,
  type MeterUsageEntry,
} from './meter-aggregation.util';

function entry(partial: Partial<MeterUsageEntry> & Pick<MeterUsageEntry, 'id'>): MeterUsageEntry {
  return {
    meterId: 'meter-1',
    value: 10,
    attachmentType: 'plan',
    addonId: null,
    periodStart: new Date('2026-01-10T00:00:00Z'),
    periodEnd: new Date('2026-01-20T00:00:00Z'),
    createdAt: new Date('2026-01-15T00:00:00Z'),
    ...partial,
  };
}

describe('meter-aggregation.util', () => {
  describe('resolveEffectiveUnitPriceNet', () => {
    it('uses override when present', () => {
      expect(resolveEffectiveUnitPriceNet(2.5, 1)).toBe(2.5);
    });

    it('falls back to default when override is null', () => {
      expect(resolveEffectiveUnitPriceNet(null, '1.25')).toBe(1.25);
    });
  });

  describe('isUsageInChargeWindow', () => {
    const windowStart = new Date('2026-01-01T00:00:00Z');
    const windowEnd = new Date('2026-01-31T00:00:00Z');
    const nextWindowStart = new Date('2026-02-01T00:00:00Z');
    const nextWindowEnd = new Date('2026-02-28T00:00:00Z');

    it('includes when periodEnd is inside window', () => {
      expect(
        isUsageInChargeWindow(
          entry({
            id: 'in-end',
            periodStart: new Date('2025-12-01T00:00:00Z'),
            periodEnd: new Date('2026-01-15T00:00:00Z'),
          }),
          windowStart,
          windowEnd,
        ),
      ).toBe(true);
    });

    it('excludes when only periodStart is inside window (settles in later period)', () => {
      expect(
        isUsageInChargeWindow(
          entry({
            id: 'span-start',
            periodStart: new Date('2026-01-15T00:00:00Z'),
            periodEnd: new Date('2026-02-15T00:00:00Z'),
          }),
          windowStart,
          windowEnd,
        ),
      ).toBe(false);
      expect(
        isUsageInChargeWindow(
          entry({
            id: 'span-end',
            periodStart: new Date('2026-01-15T00:00:00Z'),
            periodEnd: new Date('2026-02-15T00:00:00Z'),
          }),
          nextWindowStart,
          nextWindowEnd,
        ),
      ).toBe(true);
    });

    it('does not double-count spanning entries across adjacent periods', () => {
      const spanning = entry({
        id: 'span',
        periodStart: new Date('2026-01-25T00:00:00Z'),
        periodEnd: new Date('2026-02-05T00:00:00Z'),
      });

      expect(isUsageInChargeWindow(spanning, windowStart, windowEnd)).toBe(false);
      expect(isUsageInChargeWindow(spanning, nextWindowStart, nextWindowEnd)).toBe(true);
    });

    it('settles boundary periodEnd only into the ending period (left-open start)', () => {
      const onBoundary = entry({
        id: 'boundary',
        periodStart: new Date('2026-01-20T00:00:00Z'),
        periodEnd: windowEnd,
      });

      expect(isUsageInChargeWindow(onBoundary, windowStart, windowEnd)).toBe(true);
      expect(isUsageInChargeWindow(onBoundary, windowEnd, nextWindowEnd)).toBe(false);
    });

    it('excludes when periodEnd is outside window', () => {
      expect(
        isUsageInChargeWindow(
          entry({
            id: 'out',
            periodStart: new Date('2025-11-01T00:00:00Z'),
            periodEnd: new Date('2025-12-01T00:00:00Z'),
          }),
          windowStart,
          windowEnd,
        ),
      ).toBe(false);
    });
  });

  describe('filterEntriesForAttachment', () => {
    const periodStart = new Date('2026-01-01T00:00:00Z');
    const periodEnd = new Date('2026-01-31T00:00:00Z');
    const entries = [
      entry({ id: 'a', attachmentType: 'plan', value: 1 }),
      entry({ id: 'b', attachmentType: 'addon', addonId: 'addon-1', value: 2 }),
      entry({ id: 'c', attachmentType: 'addon', addonId: 'addon-2', value: 3 }),
    ];

    it('filters plan attachment without mixing addon rows', () => {
      const filtered = filterEntriesForAttachment(entries, {
        meterId: 'meter-1',
        attachmentType: 'plan',
        periodStart,
        periodEnd,
      });

      expect(filtered.map((row) => row.id)).toEqual(['a']);
    });

    it('scopes addon attachment by addonId', () => {
      const filtered = filterEntriesForAttachment(entries, {
        meterId: 'meter-1',
        attachmentType: 'addon',
        addonId: 'addon-1',
        periodStart,
        periodEnd,
      });

      expect(filtered.map((row) => row.id)).toEqual(['b']);
    });
  });

  describe('aggregateMeterValues', () => {
    const rows = [
      entry({ id: '1', value: 5, createdAt: new Date('2026-01-01T00:00:00Z') }),
      entry({ id: '2', value: 15, createdAt: new Date('2026-01-02T00:00:00Z') }),
      entry({ id: '3', value: 10, createdAt: new Date('2026-01-03T00:00:00Z') }),
    ];

    it('aggregates max min avg first last', () => {
      expect(aggregateMeterValues(rows, 'max')).toBe(15);
      expect(aggregateMeterValues(rows, 'min')).toBe(5);
      expect(aggregateMeterValues(rows, 'avg')).toBe(10);
      expect(aggregateMeterValues(rows, 'first')).toBe(5);
      expect(aggregateMeterValues(rows, 'last')).toBe(10);
    });

    it('sums sample values', () => {
      expect(aggregateMeterValues(rows, 'sum')).toBe(30);
      expect(aggregateMeterValues([entry({ id: 'only', value: 7 })], 'sum')).toBe(7);
      expect(aggregateMeterValues([], 'sum')).toBe(0);
    });

    it('sums positive deltas between consecutive samples', () => {
      const increasing = [
        entry({ id: 'a', value: 10, createdAt: new Date('2026-01-01T00:00:00Z') }),
        entry({ id: 'b', value: 25, createdAt: new Date('2026-01-02T00:00:00Z') }),
        entry({ id: 'c', value: 40, createdAt: new Date('2026-01-03T00:00:00Z') }),
      ];

      expect(aggregateMeterValues(increasing, 'sum_positive_deltas')).toBe(30);
      expect(aggregateMeterValues([entry({ id: 'only', value: 12 })], 'sum_positive_deltas')).toBe(12);
      expect(aggregateMeterValues([], 'sum_positive_deltas')).toBe(0);
    });

    it('treats counter resets as a fresh series for sum_positive_deltas', () => {
      const withReset = [
        entry({ id: 'a', value: 100, createdAt: new Date('2026-01-01T00:00:00Z') }),
        entry({ id: 'b', value: 150, createdAt: new Date('2026-01-02T00:00:00Z') }),
        entry({ id: 'c', value: 20, createdAt: new Date('2026-01-03T00:00:00Z') }),
        entry({ id: 'd', value: 35, createdAt: new Date('2026-01-04T00:00:00Z') }),
      ];

      // +50 then reset adds 20 then +15
      expect(aggregateMeterValues(withReset, 'sum_positive_deltas')).toBe(85);
    });

    it('sums decreasing series as successive resets for sum_positive_deltas', () => {
      const decreasing = [
        entry({ id: 'a', value: 30, createdAt: new Date('2026-01-01T00:00:00Z') }),
        entry({ id: 'b', value: 20, createdAt: new Date('2026-01-02T00:00:00Z') }),
        entry({ id: 'c', value: 5, createdAt: new Date('2026-01-03T00:00:00Z') }),
      ];

      expect(aggregateMeterValues(decreasing, 'sum_positive_deltas')).toBe(25);
    });

    it('returns 0 for empty set', () => {
      expect(aggregateMeterValues([], 'max')).toBe(0);
    });
  });
});
