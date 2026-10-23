import type { UsageReport } from '@forepath/loadweaver/frontend/data-access-console';

import { bucketFormat, formatUsageValue, meterTotals, meterUnit, pivotUsage } from './usage-format';

const report: UsageReport = {
  cluster: 'lab',
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-03T00:00:00.000Z',
  granularity: 'day',
  meters: [
    { key: 'cpu_core_hours', unit: 'core-hours', description: 'CPU' },
    { key: 'public_ip_hours', unit: 'IP-hours', description: 'IPs' },
  ],
  rows: [
    { project: 'shop', bucket: '2026-10-01T00:00:00.000Z', meter: 'cpu_core_hours', value: 1, final: true },
    { project: 'shop', bucket: '2026-10-01T00:00:00.000Z', meter: 'public_ip_hours', value: 24, final: true },
    { project: 'blog', bucket: '2026-10-02T00:00:00.000Z', meter: 'cpu_core_hours', value: 0.5, final: false },
    { project: 'shop', bucket: '2026-10-02T00:00:00.000Z', meter: 'cpu_core_hours', value: 2, final: false },
  ],
  totals: [
    { project: 'blog', meter: 'cpu_core_hours', value: 0.5 },
    { project: 'shop', meter: 'cpu_core_hours', value: 3 },
    { project: 'shop', meter: 'public_ip_hours', value: 24 },
  ],
  truncated: false,
};

describe('usage format (3.24)', () => {
  it('pivots rows into lines per bucket and project, newest first', () => {
    expect(pivotUsage(report.rows)).toEqual([
      { bucket: '2026-10-02T00:00:00.000Z', project: 'blog', values: { cpu_core_hours: 0.5 }, final: false },
      { bucket: '2026-10-02T00:00:00.000Z', project: 'shop', values: { cpu_core_hours: 2 }, final: false },
      {
        bucket: '2026-10-01T00:00:00.000Z',
        project: 'shop',
        values: { cpu_core_hours: 1, public_ip_hours: 24 },
        final: true,
      },
    ]);
  });

  it('sums totals per meter over projects and finds units', () => {
    expect(meterTotals(report)).toEqual({ cpu_core_hours: 3.5, public_ip_hours: 24 });
    expect(meterTotals(null)).toEqual({});
    expect(meterUnit(report, 'public_ip_hours')).toBe('IP-hours');
    expect(meterUnit(report, 'traffic_in_gb')).toBe('');
  });

  it('formats buckets and values', () => {
    expect(bucketFormat('hour')).toBe('MMM d, y HH:mm');
    expect(bucketFormat('month')).toBe('MMMM y');
    expect(formatUsageValue(1.23456)).toBe('1.235');
    expect(formatUsageValue(24)).toBe('24');
    expect(formatUsageValue(undefined)).toBe('–');
  });
});
