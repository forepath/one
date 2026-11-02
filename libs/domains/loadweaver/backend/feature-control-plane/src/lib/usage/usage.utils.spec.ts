import { BadRequestException } from '@nestjs/common';

import { USAGE_METER_DEFINITIONS } from './usage.constants';
import {
  floorTo,
  isFinalBucket,
  publicAddressProject,
  resolveUsageRange,
  roundUsage,
  usageCsv,
  usageIdempotencyKey,
  usageMeterCatalog,
  usageTotals,
  type UsageReport,
} from './usage.utils';

const meter = (key: string) => USAGE_METER_DEFINITIONS.find((m) => m.key === key);
const factor = (key: string) => meter(key)?.factor ?? NaN;
const legacyFactor = (key: string) => meter(key)?.legacyFactor ?? NaN;

describe('usage metering (3.24)', () => {
  describe('aggregation math', () => {
    it('turns integrated CPU-seconds into core-hours, whatever the sampling', () => {
      // One core for an hour = 3600 CPU-seconds, however many samples (skipped ticks included) carried them.
      expect(3600 * factor('cpu_core_hours')).toBeCloseTo(1, 10);
      // 300 samples with a skipped tick each (20 s measured) of one core: still one core-hour.
      expect(300 * 20 * 0.6 * factor('cpu_core_hours')).toBeCloseTo(1, 10);
    });

    it('turns byte-seconds of memory into GiB-hours', () => {
      expect(1024 ** 3 * 3600 * factor('memory_gib_hours')).toBeCloseTo(1, 10);
    });

    it('turns byte deltas into GB', () => {
      expect(1e9 * factor('traffic_in_gb')).toBeCloseTo(1, 10);
      expect(1e9 * factor('traffic_out_gb')).toBeCloseTo(1, 10);
    });

    it('falls back to instantaneous samples × 10 s for N-1 agents', () => {
      expect(meter('cpu_core_hours')).toMatchObject({ input: 'replica.cpu_seconds', legacyInput: 'replica.cpu_cores' });
      // 360 samples × 1 core = sum(avg × samples) of the minute roll-ups of one hour.
      expect(360 * 1 * legacyFactor('cpu_core_hours')).toBeCloseTo(1, 10);
      expect(360 * 1024 ** 3 * legacyFactor('memory_gib_hours')).toBeCloseTo(1, 10);
      // 100 MB/s for one sample interval = 1 GB.
      expect(1e8 * legacyFactor('traffic_in_gb')).toBeCloseTo(1, 10);
      expect(1e8 * legacyFactor('traffic_out_gb')).toBeCloseTo(1, 10);
    });

    it('turns 12 five-minute allocation samples into hours', () => {
      // 10 GiB provisioned the whole hour = 10 GiB-hours; two addresses = 2 IP-hours.
      expect(12 * 10 * factor('storage_gib_hours')).toBeCloseTo(10, 10);
      expect(12 * 30 * factor('storage_replica_gib_hours')).toBeCloseTo(30, 10);
      expect(12 * 2 * factor('public_ip_hours')).toBeCloseTo(2, 10);
    });

    it('rounds to the 6 decimals Decabill stores', () => {
      expect(roundUsage(1.23456789)).toBe(1.234568);
      expect(roundUsage(0.0000004)).toBe(0);
    });
  });

  describe('ranges', () => {
    const now = new Date('2026-10-20T13:37:00Z');

    it('defaults to the current month by day', () => {
      expect(resolveUsageRange({}, now)).toEqual({
        from: new Date('2026-10-01T00:00:00Z'),
        to: now,
        granularity: 'day',
      });
    });

    it('floors from to the granularity (UTC)', () => {
      const t = new Date('2026-10-20T13:37:12Z');

      expect(floorTo(t, 'hour').toISOString()).toBe('2026-10-20T13:00:00.000Z');
      expect(floorTo(t, 'day').toISOString()).toBe('2026-10-20T00:00:00.000Z');
      expect(floorTo(t, 'month').toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(
        resolveUsageRange({ from: '2026-10-20T10:30:00Z', to: '2026-10-20T12:00:00Z', granularity: 'hour' }, now).from,
      ).toEqual(new Date('2026-10-20T10:00:00Z'));
    });

    it('rejects empty, inverted, invalid and too long ranges', () => {
      expect(() =>
        resolveUsageRange({ from: '2026-10-20T12:00:00Z', to: '2026-10-20T12:00:00Z', granularity: 'hour' }, now),
      ).toThrow(BadRequestException);
      expect(() => resolveUsageRange({ from: '2026-10-21T00:00:00Z', to: '2026-10-20T00:00:00Z' }, now)).toThrow(
        BadRequestException,
      );
      expect(() => resolveUsageRange({ from: 'nope' }, now)).toThrow(BadRequestException);
      expect(() =>
        resolveUsageRange({ from: '2026-01-01T00:00:00Z', to: '2026-10-01T00:00:00Z', granularity: 'hour' }, now),
      ).toThrow(/at most 93 days/);
      expect(
        resolveUsageRange({ from: '2026-01-01T00:00:00Z', to: '2026-10-01T00:00:00Z', granularity: 'day' }, now)
          .granularity,
      ).toBe('day');
    });
  });

  it('marks an hour final 15 minutes after it ended', () => {
    const bucket = new Date('2026-10-20T12:00:00Z');

    expect(isFinalBucket(bucket, new Date('2026-10-20T13:14:59Z'))).toBe(false);
    expect(isFinalBucket(bucket, new Date('2026-10-20T13:15:00Z'))).toBe(true);
  });

  it('builds one idempotency key per cluster, project, meter and hour', () => {
    expect(usageIdempotencyKey('lab', 'shop', 'cpu_core_hours', '2026-10-20T12:00:00Z')).toBe(
      'loadweaver:lab:shop:cpu_core_hours:2026-10-20T12:00:00.000Z',
    );
    expect(usageIdempotencyKey('lab', 'shop', 'cpu_core_hours', new Date('2026-10-20T12:00:00Z'))).toBe(
      usageIdempotencyKey('lab', 'shop', 'cpu_core_hours', '2026-10-20T12:00:00.000Z'),
    );
    expect(usageIdempotencyKey('lab', 'shop', 'memory_gib_hours', '2026-10-20T12:00:00Z')).not.toBe(
      usageIdempotencyKey('lab', 'shop', 'cpu_core_hours', '2026-10-20T12:00:00Z'),
    );
  });

  it('attributes only egress addresses of project policies to projects', () => {
    expect(publicAddressProject('egress/shop/outbound/0')).toBe('shop');
    expect(publicAddressProject('egress/cluster-policy/1')).toBeNull();
    expect(publicAddressProject('ingress/0')).toBeNull();
    expect(publicAddressProject('dns/ns/0')).toBeNull();
    expect(publicAddressProject('vpn/0')).toBeNull();
    expect(publicAddressProject(null)).toBeNull();
  });

  it('sums totals per project and meter', () => {
    expect(
      usageTotals([
        { project: 'b', bucket: '1', meter: 'cpu_core_hours', value: 0.1, final: true },
        { project: 'a', bucket: '1', meter: 'cpu_core_hours', value: 1, final: true },
        { project: 'b', bucket: '2', meter: 'cpu_core_hours', value: 0.2, final: true },
      ]),
    ).toEqual([
      { project: 'a', meter: 'cpu_core_hours', value: 1 },
      { project: 'b', meter: 'cpu_core_hours', value: 0.3 },
    ]);
  });

  it('exports CSV with units, finality and idempotency keys (formula-safe)', () => {
    const report: UsageReport = {
      cluster: 'lab',
      from: '2026-10-20T12:00:00.000Z',
      to: '2026-10-20T14:00:00.000Z',
      granularity: 'hour',
      meters: usageMeterCatalog(),
      rows: [
        {
          project: 'shop',
          bucket: '2026-10-20T12:00:00.000Z',
          meter: 'cpu_core_hours',
          value: 1.5,
          final: true,
          idempotencyKey: 'loadweaver:lab:shop:cpu_core_hours:2026-10-20T12:00:00.000Z',
        },
        { project: 'shop', bucket: '2026-10-20T13:00:00.000Z', meter: 'public_ip_hours', value: 1, final: false },
      ],
      totals: [],
      truncated: false,
    };

    expect(usageCsv(report).split('\n')).toEqual([
      'project,bucket,granularity,meter,unit,value,final,idempotency_key',
      '"shop","2026-10-20T12:00:00.000Z","hour","cpu_core_hours","core-hours",1.5,"true","loadweaver:lab:shop:cpu_core_hours:2026-10-20T12:00:00.000Z"',
      '"shop","2026-10-20T13:00:00.000Z","hour","public_ip_hours","IP-hours",1,"false",""',
      '',
    ]);
  });
});
