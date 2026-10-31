import { setGauge } from '@forepath/shared/backend/util-otel';

import { liveOpenAlerts } from '../alerts/alert.service';
import { OtelSummaryCollector } from '../metrics/otel-summary.collector';
import { SearchService } from './search.service';

jest.mock('../alerts/alert.service', () => ({ liveOpenAlerts: jest.fn(() => null) }));
jest.mock('@forepath/shared/backend/util-otel', () => ({
  ...jest.requireActual('@forepath/shared/backend/util-otel'),
  setGauge: jest.fn(),
}));

const live = liveOpenAlerts as jest.Mock;
const liveAlert = {
  id: 'live:builtin:node-down:n1',
  rule: 'builtin:node-down',
  key: 'n1',
  project: null,
  severity: 'critical',
  state: 'firing',
  title: 'Node n1 is down',
  started_at: new Date('2026-10-31T09:00:00Z'),
};

describe('search and the OpenTelemetry summary while the control plane is read-only (3.43 fallback)', () => {
  afterEach(() => {
    live.mockReturnValue(null);
    (setGauge as jest.Mock).mockClear();
  });

  it('search indexes the live open alerts instead of the frozen rows', async () => {
    live.mockReturnValue([liveAlert]);

    const queries: string[] = [];
    const dataSource = {
      getRepository: () => ({ find: async () => [] }),
      query: async (sql: string) => {
        queries.push(sql);

        return [{ id: 'stale', title: 'CPU load on n1', project: null }];
      },
    };
    const service = new SearchService(
      dataSource as never,
      {} as never,
      {} as never,
      {
        parse: () => ({ parsed: [] }),
      } as never,
    );
    const docs = await service.documents();

    expect(docs.map((d) => d.id)).toContain(`Alert:${liveAlert.id}`);
    expect(docs.some((d) => d.id === 'Alert:stale')).toBe(false);
    expect(queries.some((q) => q.includes('lw_alerts'))).toBe(false);
  });

  it('the summary counts connected nodes by heartbeat and firing alerts from the live evaluation', async () => {
    live.mockReturnValue([liveAlert, { ...liveAlert, id: 'p', state: 'pending' }]);

    const now = Date.now();
    const nodes = [
      { name: 'up', lifecycle: 'active', connected: true, lastSeenAt: new Date(now), capacity: { cpuMillis: 1000 } },
      // `connected` still true in the frozen row, but no heartbeat for an hour: not connected.
      {
        name: 'stale',
        lifecycle: 'active',
        connected: true,
        lastSeenAt: new Date(now - 3_600_000),
        capacity: { cpuMillis: 4000 },
      },
    ];
    const dataSource = {
      getRepository: () => ({ find: async () => nodes }),
      query: async () => [],
    };

    await new OtelSummaryCollector(dataSource as never).collect();

    const gauge = (name: string, labels: Record<string, string>) =>
      (setGauge as jest.Mock).mock.calls.find(
        (c) => c[1] === name && JSON.stringify(c[3]) === JSON.stringify(labels),
      )?.[2];

    expect(gauge('loadweaver.nodes', { lifecycle: 'active', connected: 'true' })).toBe(1);
    expect(gauge('loadweaver.nodes', { lifecycle: 'active', connected: 'false' })).toBe(1);
    expect(gauge('loadweaver.alerts.firing', { severity: 'critical' })).toBe(1);
    expect(gauge('loadweaver.capacity', { resource: 'cpuMillis' })).toBe(1000);
  });
});
