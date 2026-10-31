import { execFileSync } from 'node:child_process';

import type { RequestWithUser } from '@forepath/identity/backend';
import {
  ClusterEntity,
  LogsService,
  NodeEntity,
  ResourceEntity,
  WorkloadPlacementEntity,
  type AccessCaller,
} from '@forepath/loadweaver/backend/feature-control-plane';
import { logStoreSpec, openSearchImage } from '@forepath/loadweaver/backend/feature-node-agent';
import { OpenSearchService } from '@forepath/shared/backend/util-opensearch';

/**
 * Logs end to end against a real OpenSearch (3.14), started from the agent's own log-store container spec: node
 * batches are verified and stored per source and day, queries are scoped by access, exports and retention work.
 */

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

describe('logs in OpenSearch (lab)', () => {
  const name = `lw-logs-lab-${process.pid}-${Date.now()}`;
  const httpPort = 19200 + (process.pid % 500);
  const env = { ...process.env };
  let logs: LogsService;
  let opensearch: OpenSearchService;
  const callers = new Map<string, AccessCaller>([
    ['admin', { isApiKey: true, clusterRole: 'cluster-admin', projects: new Map() }],
    ['dev', { userId: 'dev', isApiKey: false, projects: new Map([['shop', 'developer']]) }],
    ['infra', { userId: 'infra', isApiKey: false, clusterRole: 'infra-operator', projects: new Map() }],
  ]);
  const as = (who: string) => ({ who }) as unknown as RequestWithUser;

  beforeAll(async () => {
    // `_site_`: OpenSearch's own site-local address (the container's here; the overlay address on a node).
    const spec = logStoreSpec(
      'n1',
      '_site_',
      {
        role: 'member',
        members: [{ name: 'n1', address: '127.0.0.1', witness: false }],
        automaticFailover: false,
        scope: 'lab',
        logStore: { clusterName: 'lab', heapMb: 512, httpPort, transportPort: httpPort + 100 },
      },
      '/unused',
      openSearchImage(),
    );

    docker([
      'run',
      '-d',
      '--name',
      name,
      '-p',
      `127.0.0.1:${httpPort}:${httpPort}`,
      '--memory',
      String(spec.memoryBytes),
      // The data directory belongs to OpenSearch's user (the agent chowns it on the node).
      '--tmpfs',
      '/usr/share/opensearch/data:uid=1000,gid=1000',
      ...Object.entries(spec.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      spec.image,
    ]);

    Object.assign(process.env, {
      OPENSEARCH_ENABLED: 'true',
      OPENSEARCH_NODE: `http://127.0.0.1:${httpPort}`,
      OPENSEARCH_INDEX_PREFIX: 'loadweaver',
    });
    opensearch = new OpenSearchService();

    for (let i = 0; i < 120 && !(await opensearch.ping()); i++) await new Promise((r) => setTimeout(r, 1_000));

    const repos = new Map<unknown, unknown>([
      [NodeEntity, { findOne: async () => ({ name: 'n1', site: 'fra1' }) }],
      [WorkloadPlacementEntity, { find: async () => [{ id: 'shop/site/web/0' }] }],
      [ClusterEntity, { findOne: async () => ({ clusterId: 'lab' }) }],
      [
        ResourceEntity,
        {
          findOne: async () => ({
            kind: 'Cluster',
            spec: {
              network: { podPoolV4: '10.42.0.0/16', servicePoolV4: '10.43.0.0/16', overlayPoolV4: '10.44.0.0/16' },
              observability: { logRetentionDays: { container: 2 } },
            },
          }),
        },
      ],
    ]);
    const dataSource = { getRepository: (entity: unknown) => repos.get(entity) };
    const access = { caller: async (req: { who: string }) => callers.get(req.who) };

    logs = new LogsService(dataSource as never, opensearch, access as never);
  }, 180_000);

  afterAll(async () => {
    process.env = env;
    await opensearch?.onModuleDestroy();

    try {
      docker(['rm', '-f', name]);
    } catch {
      // gone
    }
  });

  it('stores verified node batches and scopes queries by access', async () => {
    const now = new Date();
    const at = (offsetMs: number) => new Date(now.getTime() - offsetMs).toISOString();

    expect(await logs.ensureTemplate()).toBe(true);
    expect(
      await logs.ingest('n1', {
        entries: [
          {
            at: at(3000),
            source: 'container',
            level: 'info',
            message: 'GET /cart 200',
            labels: {
              project: 'shop',
              deployment: 'site',
              service: 'web',
              replica: 'shop/site/web/0',
              stream: 'stdout',
            },
          },
          // Not running on n1: a node can't write into other workloads' logs.
          {
            at: at(2000),
            source: 'container',
            level: 'info',
            message: 'forged',
            labels: { project: 'bank', deployment: 'core', service: 'api', replica: 'bank/core/api/0' },
          },
          {
            at: at(1000),
            source: 'firewall',
            level: 'warn',
            message: 'denied tcp 10.42.1.10:1234 → 10.42.2.10:5432',
            labels: {},
            fields: { decision: 'denied', dpt: '5432' },
          },
        ],
        dropped: 7,
      }),
    ).toEqual({ accepted: 3, rejected: 1, stored: true });

    await new Promise((r) => setTimeout(r, 2_000));

    const all = await logs.query(as('admin'), {});

    expect(all.lines.map((l) => l.message)).toEqual([
      expect.stringContaining('7 log lines were dropped on n1'),
      'denied tcp 10.42.1.10:1234 → 10.42.2.10:5432',
      'GET /cart 200',
    ]);
    expect(all.lines.find((l) => l.source === 'container')).toMatchObject({
      node: 'n1',
      site: 'fra1',
      labels: { replica: 'shop/site/web/0' },
    });
    // Project members: their project's lines, no platform lines; infra operators: the reverse.
    expect((await logs.query(as('dev'), {})).lines.map((l) => l.message)).toEqual(['GET /cart 200']);
    expect((await logs.query(as('infra'), {})).lines.every((l) => !l.labels.project)).toBe(true);
    await expect(logs.query(as('dev'), { project: 'bank' })).rejects.toThrow('project not found');
    // Filters: full text, source, level; paging by cursor.
    expect((await logs.query(as('admin'), { text: 'cart' })).lines).toHaveLength(1);
    expect((await logs.query(as('admin'), { sources: ['firewall'], levels: ['warn'] })).lines).toHaveLength(1);

    const page = await logs.query(as('admin'), { limit: 1 });
    const next = await logs.query(as('admin'), { limit: 1, cursor: page.cursor as string });

    expect(next.lines[0].message).not.toBe(page.lines[0].message);
    expect(await logs.export(as('dev'), {}, 'csv')).toContain('"GET /cart 200"');
  }, 120_000);

  it('drops indices past their retention', async () => {
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();

    await logs.ingest('n1', {
      entries: [
        {
          at: old,
          source: 'container',
          level: 'info',
          message: 'old',
          labels: { project: 'shop', deployment: 'site', service: 'web', replica: 'shop/site/web/0' },
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 1_500));

    // The cluster keeps container logs for 2 days here; firewall logs keep their 7-day default.
    expect(await logs.retention()).toEqual([`loadweaver-logs-container-${old.slice(0, 10)}`]);
    expect(await opensearch.listIndices('loadweaver-logs-*')).not.toContain(
      `loadweaver-logs-container-${old.slice(0, 10)}`,
    );
  }, 60_000);
});
