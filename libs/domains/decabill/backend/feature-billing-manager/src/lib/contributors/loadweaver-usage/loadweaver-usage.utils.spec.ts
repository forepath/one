import { LOADWEAVER_USAGE_METERS, LOADWEAVER_USAGE_METER_MAP } from './loadweaver-usage.constants';
import {
  loadweaverUsageSamples,
  loadweaverUsageWindow,
  resolveLoadweaverUsageConnection,
  type LoadweaverUsageReport,
} from './loadweaver-usage.utils';

const SUB = '6f1c1d5e-6a43-4c38-9a59-7f6d4f0e2a10';

const row = (bucket: string, value: number, overrides: Partial<LoadweaverUsageReport['rows'][number]> = {}) => ({
  project: 'shop',
  bucket,
  meter: 'cpu_core_hours',
  value,
  final: true,
  idempotencyKey: `loadweaver:lab:shop:cpu_core_hours:${new Date(bucket).toISOString()}`,
  billingSubscription: SUB,
  ...overrides,
});

describe('Loadweaver usage module', () => {
  it('declares one hourly sum meter per Loadweaver meter', () => {
    expect(LOADWEAVER_USAGE_METERS.map((m) => m.key).sort()).toEqual(Object.keys(LOADWEAVER_USAGE_METER_MAP).sort());
    expect(LOADWEAVER_USAGE_METERS.every((m) => m.aggregator === 'sum' && m.collectionIntervalMs === 3_600_000)).toBe(
      true,
    );
  });

  describe('connection', () => {
    const defaults = { LOADWEAVER_API_URL: 'https://lw.example.com/api/', LOADWEAVER_API_TOKEN: 'pat' };

    it('reads URL and token from the admin defaults', () => {
      expect(resolveLoadweaverUsageConnection(defaults, false)).toEqual({
        url: 'https://lw.example.com/api',
        token: 'pat',
      });
    });

    it('requires both, HTTPS (unless allowed) and a plain URL', () => {
      expect(() => resolveLoadweaverUsageConnection({ LOADWEAVER_API_URL: 'https://x' }, false)).toThrow(/needs/);
      expect(() => resolveLoadweaverUsageConnection(undefined, false)).toThrow(/needs/);
      expect(() =>
        resolveLoadweaverUsageConnection({ ...defaults, LOADWEAVER_API_URL: 'http://lw.local/api' }, false),
      ).toThrow(/HTTPS/);
      expect(
        resolveLoadweaverUsageConnection({ ...defaults, LOADWEAVER_API_URL: 'http://lw.local/api' }, true).url,
      ).toBe('http://lw.local/api');
      expect(() =>
        resolveLoadweaverUsageConnection({ ...defaults, LOADWEAVER_API_URL: 'https://u:p@lw.example.com' }, false),
      ).toThrow(/credentials/);
      expect(() => resolveLoadweaverUsageConnection({ ...defaults, LOADWEAVER_API_URL: 'file:///etc' }, false)).toThrow(
        /HTTPS/,
      );
      expect(() => resolveLoadweaverUsageConnection({ ...defaults, LOADWEAVER_API_URL: 'nope' }, false)).toThrow(
        /valid URL/,
      );
    });
  });

  describe('windows', () => {
    it('shifts the primary range back by the settle time and adds a lookback', () => {
      const w = loadweaverUsageWindow(new Date('2026-10-20T10:05:00Z'), new Date('2026-10-20T11:05:00Z'));

      expect(w.primaryFrom.toISOString()).toBe('2026-10-20T09:45:00.000Z');
      expect(w.primaryTo.toISOString()).toBe('2026-10-20T10:45:00.000Z');
      expect(w.from.toISOString()).toBe('2026-10-20T05:00:00.000Z');
      expect(w.to).toEqual(w.primaryTo);
    });

    it('assigns every hour to exactly one of consecutive windows', () => {
      const report: LoadweaverUsageReport = {
        cluster: 'lab',
        truncated: false,
        rows: Array.from({ length: 6 }, (_, i) => row(new Date(Date.UTC(2026, 9, 20, 6 + i)).toISOString(), 1)),
      };
      const ends = ['2026-10-20T08:05:00Z', '2026-10-20T09:05:00Z', '2026-10-20T10:07:00Z', '2026-10-20T12:30:00Z'];
      const primaryHours: string[] = [];

      for (let i = 1; i < ends.length; i++) {
        const periodStart = new Date(ends[i - 1]);
        const periodEnd = new Date(ends[i]);
        const { primaryFrom } = loadweaverUsageWindow(periodStart, periodEnd);
        const samples = loadweaverUsageSamples({
          report,
          meterKey: 'loadweaver.cpu_core_hours',
          subscriptionId: SUB,
          periodStart,
          periodEnd,
        });

        primaryHours.push(
          ...samples
            .filter((s) => typeof s.usagePayload?.['bucket'] === 'string')
            .map((s) => s.usagePayload?.['bucket'] as string)
            .filter((b) => new Date(b).getTime() + 3_600_000 > primaryFrom.getTime()),
        );
      }

      // Hours ending in (07:45, 12:10]: 07:00 … 11:00 — no hour twice, none missing.
      expect(primaryHours).toEqual([
        '2026-10-20T07:00:00.000Z',
        '2026-10-20T08:00:00.000Z',
        '2026-10-20T09:00:00.000Z',
        '2026-10-20T10:00:00.000Z',
        '2026-10-20T11:00:00.000Z',
      ]);
    });
  });

  describe('samples', () => {
    const periodStart = new Date('2026-10-20T10:05:00Z');
    const periodEnd = new Date('2026-10-20T11:05:00Z');

    it('emits one keyed sample per final hour, project and meter (lookback included)', () => {
      const report: LoadweaverUsageReport = {
        cluster: 'lab',
        truncated: false,
        rows: [
          row('2026-10-20T07:00:00Z', 0.5),
          row('2026-10-20T09:00:00Z', 2, { project: 'blog', idempotencyKey: 'k-blog' }),
          row('2026-10-20T09:00:00Z', 1.25),
          // Not final yet / other meter / other subscription / zero / not in range.
          row('2026-10-20T09:00:00Z', 9, { final: false, idempotencyKey: 'k-open' }),
          row('2026-10-20T09:00:00Z', 9, { meter: 'memory_gib_hours', idempotencyKey: 'k-mem' }),
          row('2026-10-20T09:00:00Z', 9, { billingSubscription: 'other', idempotencyKey: 'k-other' }),
          row('2026-10-20T08:00:00Z', 0, { idempotencyKey: 'k-zero' }),
          row('2026-10-20T10:00:00Z', 9, { idempotencyKey: 'k-future' }),
        ],
      };

      const samples = loadweaverUsageSamples({
        report,
        meterKey: 'loadweaver.cpu_core_hours',
        subscriptionId: SUB,
        periodStart,
        periodEnd,
      });

      expect(samples).toEqual([
        {
          meterKey: 'loadweaver.cpu_core_hours',
          value: 0.5,
          idempotencyKey: 'loadweaver:lab:shop:cpu_core_hours:2026-10-20T07:00:00.000Z',
          usagePayload: {
            source: 'loadweaver',
            cluster: 'lab',
            project: 'shop',
            meter: 'cpu_core_hours',
            bucket: '2026-10-20T07:00:00.000Z',
          },
        },
        expect.objectContaining({ value: 2, idempotencyKey: 'k-blog' }),
        expect.objectContaining({ value: 1.25 }),
      ]);
    });

    it('marks an empty window with one zero sample keyed by its end', () => {
      const samples = loadweaverUsageSamples({
        report: { cluster: 'lab', truncated: false, rows: [row('2026-10-20T07:00:00Z', 3)] },
        meterKey: 'loadweaver.public_ip_hours',
        subscriptionId: SUB,
        periodStart,
        periodEnd,
      });

      expect(samples).toEqual([
        {
          meterKey: 'loadweaver.public_ip_hours',
          value: 0,
          idempotencyKey: `loadweaver:lab:window:${SUB}:public_ip_hours:2026-10-20T11:05:00.000Z`,
          usagePayload: { source: 'loadweaver', cluster: 'lab', meter: 'public_ip_hours', empty: true },
        },
      ]);
    });

    it('ignores unknown meter keys', () => {
      expect(
        loadweaverUsageSamples({
          report: { cluster: 'lab', truncated: false, rows: [] },
          meterKey: 'other.meter',
          subscriptionId: SUB,
          periodStart,
          periodEnd,
        }),
      ).toEqual([]);
    });
  });
});
