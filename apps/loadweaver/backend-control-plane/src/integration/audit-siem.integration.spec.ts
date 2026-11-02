import { execFileSync } from 'node:child_process';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';

import type { RequestWithUser } from '@forepath/identity/backend';
import {
  AuditEventEntity,
  AuditLogService,
  AuditService,
  ClusterEntity,
  computeAuditHash,
  LogsService,
  SiemForwarderService,
  type AccessCaller,
} from '@forepath/loadweaver/backend/feature-control-plane';
import { logStoreSpec, openSearchImage } from '@forepath/loadweaver/backend/feature-node-agent';
import { OpenSearchService } from '@forepath/shared/backend/util-opensearch';
import { DataSource } from 'typeorm';

import { CreateControlPlaneTables1800000000000 } from '../migrations/1800000000000_CreateControlPlaneTables';
import { CreateAuditMirrorAndSiem1800000000021 } from '../migrations/1800000000021_CreateAuditMirrorAndSiem';
import { POSTGRES_IMAGE } from './postgres.container';

/**
 * The audit log beyond its chain (3.18), against a real Postgres and OpenSearch: mirrored for full-text search,
 * the chain head anchored outside the database (a chain rewritten by someone with database access no longer matches
 * its anchors), scoped search / export, and SIEM forwarding of audit entries and log lines over syslog (TCP),
 * OTLP and webhooks, with retries.
 */

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

describe('audit mirror, anchors and SIEM forwarding (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const names = { postgres: `lw-audit-lab-pg-${run}`, opensearch: `lw-audit-lab-os-${run}` };
  const pgPort = 26432 + (process.pid % 500);
  const httpPort = 19700 + (process.pid % 200);
  const env = { ...process.env };
  const callers = new Map<string, AccessCaller>([
    ['admin', { isApiKey: true, clusterRole: 'cluster-admin', projects: new Map() }],
    ['shop-admin', { userId: 'a', isApiKey: false, projects: new Map([['shop', 'admin']]) }],
    ['shop-dev', { userId: 'd', isApiKey: false, projects: new Map([['shop', 'developer']]) }],
  ]);
  const as = (who: string) => ({ who }) as unknown as RequestWithUser;
  let dataSource: DataSource;
  let opensearch: OpenSearchService;
  let chain: AuditLogService;
  let audit: AuditService;
  let logs: LogsService;
  const servers: Server[] = [];
  const syslog: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- received JSON bodies
  const webhook: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- received JSON bodies
  const otlp: any[] = [];
  let webhookStatus = 503;

  const record = async (action: string, target: string, project: string | null, details = {}) =>
    await chain.recordStandalone({ actor: { type: 'user', id: 'u1' }, action, target, project, details });

  beforeAll(async () => {
    docker([
      'run',
      '-d',
      '--name',
      names.postgres,
      '-p',
      `127.0.0.1:${pgPort}:5432`,
      '-e',
      'POSTGRES_PASSWORD=lab',
      POSTGRES_IMAGE,
    ]);

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
      names.opensearch,
      '-p',
      `127.0.0.1:${httpPort}:${httpPort}`,
      '--memory',
      String(spec.memoryBytes),
      '--tmpfs',
      '/usr/share/opensearch/data:uid=1000,gid=1000',
      ...Object.entries(spec.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      spec.image,
    ]);

    dataSource = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: pgPort,
      username: 'postgres',
      password: 'lab',
      database: 'postgres',
      // The log store reads the cluster id (none here).
      entities: [AuditEventEntity, ClusterEntity],
    });

    for (let i = 0; i < 60; i++) {
      try {
        await dataSource.initialize();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }

    await dataSource.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    // The control-plane tables reference the identity users table.
    await dataSource.query(`CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY)`);

    const runner = dataSource.createQueryRunner();

    await new CreateControlPlaneTables1800000000000().up(runner);
    await new CreateAuditMirrorAndSiem1800000000021().up(runner);
    await runner.release();

    Object.assign(process.env, {
      OPENSEARCH_ENABLED: 'true',
      OPENSEARCH_NODE: `http://127.0.0.1:${httpPort}`,
      OPENSEARCH_INDEX_PREFIX: 'loadweaver',
    });
    opensearch = new OpenSearchService();

    for (let i = 0; i < 120 && !(await opensearch.ping()); i++) await new Promise((r) => setTimeout(r, 1_000));

    const access = { caller: async (req: { who: string }) => callers.get(req.who) };

    chain = new AuditLogService(dataSource);
    logs = new LogsService(dataSource, opensearch, access as never);
    audit = new AuditService(dataSource, access as never, opensearch, logs);
  }, 240_000);

  afterAll(async () => {
    process.env = env;
    servers.forEach((s) => s.close());
    await opensearch?.onModuleDestroy();

    if (dataSource?.isInitialized) await dataSource.destroy();

    for (const name of Object.values(names))
      try {
        docker(['rm', '-f', name]);
      } catch {
        // gone
      }
  });

  it('mirrors the audit log for full-text search and scopes search and export', async () => {
    await record('plan.apply', 'plan/p1', 'shop', { note: 'blue green rollout' });
    await record('project.member.set', 'project/shop/member/u2', 'shop', { role: 'viewer' });
    await record('cluster.member.set', 'cluster/member/u3', null, { role: 'auditor' });

    expect(await audit.tick()).toBe(true);
    await opensearch.searchRaw(audit.index, { size: 0, query: { match_all: {} } });
    // Make the mirror searchable right away (OpenSearch refreshes every second).
    await new Promise((r) => setTimeout(r, 1_500));

    const hits = await audit.list(as('admin'), { text: 'rollout' });

    expect(hits.entries.map((e) => e.action)).toEqual(['plan.apply']);
    expect((await audit.list(as('admin'), { action: 'project.*' })).entries.map((e) => e.target)).toEqual([
      'project/shop/member/u2',
    ]);
    // Project admins see their project only; developers nothing.
    expect((await audit.list(as('shop-admin'), {})).entries.map((e) => e.project)).toEqual(['shop', 'shop']);
    await expect(audit.list(as('shop-dev'), {})).rejects.toThrow('no audit entries visible');
    await expect(audit.list(as('shop-admin'), { project: 'other' })).rejects.toThrow('project not found');

    const page = await audit.list(as('admin'), { limit: 2 });

    expect(page.entries.map((e) => e.seq)).toEqual(['3', '2']);
    expect((await audit.list(as('admin'), { limit: 2, before: page.before ?? '' })).entries.map((e) => e.seq)).toEqual([
      '1',
    ]);

    const csv = await audit.export(as('admin'), {}, 'csv');

    expect(csv.split('\n')[0]).toBe('seq,at,actorType,actorId,actorEmail,action,target,project,details,hash');
    expect(csv).toContain('"plan.apply"');
  });

  it('anchors the chain head outside the database and detects a rewritten chain', async () => {
    const anchors = await audit.verifyAnchors();

    expect(anchors).toEqual({ checked: 1, mismatched: [], available: true });
    expect((await chain.verify()).ok).toBe(true);

    // Someone with database access rewrites entry 2 and recomputes the whole chain after it.
    await dataSource.query(`ALTER TABLE lw_audit_events DISABLE TRIGGER USER`);

    const events: AuditEventEntity[] = await dataSource.getRepository(AuditEventEntity).find({ order: { seq: 'ASC' } });
    let prevHash = events[0].hash;

    for (const event of events.slice(1)) {
      const details = event.seq === '2' ? { role: 'admin' } : event.details;
      const rest = {
        seq: event.seq,
        at: event.at,
        actorType: event.actorType,
        actorId: event.actorId,
        action: event.action,
        target: event.target,
        project: event.project,
        details,
      };
      const hash = computeAuditHash(prevHash, rest);

      await dataSource.query(`UPDATE lw_audit_events SET details = $2, prev_hash = $3, hash = $4 WHERE seq = $1`, [
        event.seq,
        JSON.stringify(details),
        prevHash,
        hash,
      ]);
      prevHash = hash;
    }

    await dataSource.query(`ALTER TABLE lw_audit_events ENABLE TRIGGER USER`);

    // The chain alone still verifies; its anchor doesn't.
    expect((await chain.verify()).ok).toBe(true);
    expect(await audit.verifyAnchors()).toEqual({ checked: 1, mismatched: ['3'], available: true });
  });

  it('forwards audit entries and log lines to syslog, OTLP and webhook targets, retrying failed ones', async () => {
    const tcp = createTcpServer((socket) => {
      let data = '';

      socket.on('data', (chunk) => (data += chunk.toString('utf8')));
      socket.on('end', () => {
        // Octet-counted frames.
        for (let rest = data; rest.length; ) {
          const space = rest.indexOf(' ');
          const length = Number(rest.slice(0, space));

          syslog.push(
            Buffer.from(rest.slice(space + 1))
              .subarray(0, length)
              .toString('utf8'),
          );
          rest = Buffer.from(rest.slice(space + 1))
            .subarray(length)
            .toString('utf8');
        }
      });
    });
    const http = createHttpServer((req, res) => {
      let body = '';

      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (req.url === '/v1/logs') {
          otlp.push({ auth: req.headers['authorization'], body: JSON.parse(body) });
          res.end('{}');
        } else {
          webhook.push({ key: req.headers['x-api-key'], body: JSON.parse(body) });
          res.statusCode = webhookStatus;
          res.end();
        }
      });
    });

    servers.push(tcp as unknown as Server, http);
    await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));

    const tcpPort = (tcp.address() as AddressInfo).port;
    const httpUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const targets = [
      { name: 'syslog', type: 'syslog', url: `tcp://127.0.0.1:${tcpPort}`, sources: ['audit'] },
      {
        name: 'collector',
        type: 'otlp',
        url: `${httpUrl}/v1/logs`,
        sources: ['container'],
        levels: ['error'],
        credentials: 'secret://ops/otlp',
      },
      {
        name: 'hook',
        type: 'webhook',
        url: `${httpUrl}/hook`,
        sources: ['audit', 'container'],
        credentials: 'secret://ops/hook',
      },
    ];
    const forwarder = new SiemForwarderService(
      dataSource,
      { clusterSpec: async () => ({ observability: { siem: targets } }) } as never,
      logs,
      opensearch,
      {
        providerConfig: async (ref: string) =>
          ref.endsWith('/otlp') ? { apiToken: 'otlp-token' } : { 'X-Api-Key': 'k1' },
      } as never,
      { cluster: async () => ({ clusterId: 'lab' }) } as never,
    );

    // Lines wait a while before forwarding (30 s by default; 5 s in the lab).
    forwarder.logLagMs = 5_000;
    // A fresh target starts with the last two minutes of logs.
    await logs.write([
      { source: 'container', level: 'error', message: 'payment failed', labels: { project: 'shop' } },
      { source: 'container', level: 'info', message: 'request served', labels: { project: 'shop' } },
    ]);
    await new Promise((r) => setTimeout(r, 6_500));

    expect(await forwarder.tick()).toBe(true);

    // Syslog: every audit entry, RFC 5424 with its chain hash.
    expect(syslog).toHaveLength(3);
    expect(syslog[0]).toMatch(/^<86>1 \S+ \S+ loadweaver - audit \[loadweaver@32473 seq="1" action="plan.apply" /);
    expect(syslog[2]).toContain(`hash="`);

    // OTLP: only error lines of the container source, with the token as bearer.
    expect(otlp).toHaveLength(1);
    expect(otlp[0].auth).toBe('Bearer otlp-token');
    expect(
      otlp[0].body.resourceLogs[0].scopeLogs[0].logRecords.map(
        (r: { body: { stringValue: string } }) => r.body.stringValue,
      ),
    ).toEqual(['payment failed']);

    // The webhook answered 503: nothing advanced, the target backs off.
    expect(webhook).toHaveLength(1);
    expect(webhook[0].key).toBe('k1');
    expect(webhook[0].body.records).toHaveLength(5);

    const status = await forwarder.status();

    expect(status.find((s) => s.name === 'hook')).toMatchObject({ forwarded: 0, failures: 1, lastError: 'HTTP 503' });
    expect(status.find((s) => s.name === 'syslog')).toMatchObject({ forwarded: 3, failures: 0 });

    // Nothing new for the others; the webhook is retried after its backoff and then caught up.
    webhookStatus = 200;
    expect(await forwarder.tick(new Date(Date.now() + 11_000))).toBe(true);
    expect(syslog).toHaveLength(3);
    expect(webhook).toHaveLength(2);
    expect(webhook[1].body.records.map((r: { kind: string }) => r.kind)).toEqual([
      'audit',
      'audit',
      'audit',
      'log',
      'log',
    ]);
    expect((await forwarder.status()).find((s) => s.name === 'hook')).toMatchObject({ forwarded: 5, failures: 0 });

    // New entries go out once.
    await record('plan.apply', 'plan/p2', 'shop');
    await forwarder.tick(new Date(Date.now() + 22_000));
    expect(syslog).toHaveLength(4);
    expect(webhook.at(-1).body.records).toHaveLength(1);
  }, 60_000);
});
