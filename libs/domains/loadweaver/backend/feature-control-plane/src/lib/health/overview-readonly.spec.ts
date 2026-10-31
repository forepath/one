import { databaseTarget } from '../database-handover/database-target.runtime';
import { NodeEntity } from '../entities/node.entity';
import { liveTraffic, resetFrozenMetricsAsOf } from '../metrics/read-only-metrics';
import { OverviewService } from './overview.service';
import { SloService } from './slo.service';
import { WallboardService } from './wallboard.service';

const AS_OF = '2026-10-31T08:00:00.000Z';
const admin = { isApiKey: false, clusterRole: 'cluster-admin', projects: new Map() };

describe('overview, SLOs and wallboards while the control plane is read-only (3.43 fallback)', () => {
  beforeEach(() => resetFrozenMetricsAsOf());

  afterEach(() => {
    databaseTarget.reset();
    liveTraffic.clear();
  });

  function overview(queries: string[]) {
    const now = Date.now();
    const nodes = [
      { name: 'n1', site: 'a', lifecycle: 'active', witness: false, connected: true, lastSeenAt: new Date(now) },
    ].map((n) => ({ ...n, capacity: { cpuMillis: 1000, memoryBytes: 10, diskBytes: 1 }, usage: null }));
    const dataSource = {
      getRepository: (entity: unknown) => ({ find: async () => (entity === NodeEntity ? nodes : []) }),
      query: async (sql: string) => {
        queries.push(sql);

        return sql.includes('max("time")') ? [{ t: AS_OF }] : [{ rps: '3', n: '4' }];
      },
    };

    return new OverviewService(
      dataSource as never,
      {} as never,
      { currentRows: async () => [] } as never,
      { listFor: async () => [] } as never,
      {} as never,
      {} as never,
      { listFor: async () => [] } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  const summary = (service: OverviewService) =>
    (service as unknown as { summary(caller: unknown): Promise<Record<string, unknown>> }).summary(admin);

  it('serves live traffic and says until when the SLOs reach', async () => {
    databaseTarget.setFallback(true);
    liveTraffic.record(
      'n1',
      {
        samples: [{ metric: 'ingress.requests_per_s', entity: 'shop.example.com', value: 8 }],
        flows: [
          { policy: 'p', src: 'a', dst: 'b', protocol: 'tcp', port: 1, decision: 'denied', packets: 2, bytes: 1 },
        ],
      },
      Date.now(),
    );

    const queries: string[] = [];
    const result = await summary(overview(queries));

    expect(result).toMatchObject({ requestsPerSecond: 8, deniedPackets5m: 2, readOnly: { metricsAsOf: AS_OF } });
    expect(queries.some((q) => q.includes('lw_flows'))).toBe(false);
  });

  it('reads the stored traffic and has no read-only note while writable', async () => {
    const queries: string[] = [];
    const result = await summary(overview(queries));

    expect(result).toMatchObject({ requestsPerSecond: 3, deniedPackets5m: 4 });
    expect(result['readOnly']).toBeUndefined();
  });

  it('evaluates SLOs as of the last stored sample and marks them', async () => {
    databaseTarget.setFallback(true);

    const params: unknown[][] = [];
    const dataSource = {
      getRepository: () => ({ find: async () => [] }),
      query: async (sql: string, p: unknown[] = []) => {
        params.push(p);

        if (sql.includes('max("time")')) return [{ t: AS_OF }];

        return sql.includes('ingress.requests_per_s')
          ? [
              { metric: 'ingress.requests_per_s', v: '100' },
              { metric: 'ingress.errors_per_s', v: '0' },
            ]
          : [];
      },
    };
    const planner = {
      parse: () => ({
        parsed: [
          {
            project: 'shop',
            name: 'web',
            compose: {
              services: [
                { name: 'web', slo: { window: '7d', availability: 99 }, http: [{ host: 'shop.example.com' }] },
              ],
            },
          },
        ],
      }),
    };
    const [slo] = await new SloService(dataSource as never, {} as never, planner as never).all();

    expect(slo).toMatchObject({ asOf: AS_OF, state: 'ok' });
    // The last hour ends at the last sample, not at "now" (which would have no traffic at all).
    expect(params.some((p) => p[0] instanceof Date && p[0].toISOString() === '2026-10-31T07:00:00.000Z')).toBe(true);
  });

  it('a wallboard view does not write its last use during the fallback', async () => {
    databaseTarget.setFallback(true);

    const statements: string[] = [];
    const dataSource = {
      query: async (sql: string) => {
        statements.push(sql);

        return sql.includes('FROM lw_wallboard_tokens')
          ? [{ id: 't1', name: 'NOC', projects: null, project_ids: null, creator_basis: 'api-key' }]
          : [];
      },
    };
    const service = new WallboardService(
      dataSource as never,
      {} as never,
      {} as never,
      {
        kiosk: async () => [],
      } as never,
    );

    await expect(service.kiosk(`Wallboard lw_wb_${'a'.repeat(43)}`)).resolves.toEqual({ name: 'NOC', sections: [] });
    expect(statements.some((s) => s.startsWith('UPDATE'))).toBe(false);
  });
});
