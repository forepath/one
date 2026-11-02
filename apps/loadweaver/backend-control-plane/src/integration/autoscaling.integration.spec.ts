import type { AddressInfo } from 'node:net';

import { AutoscalerService, DEFAULT_AUTOSCALE_TIMING } from '@forepath/loadweaver/backend/feature-control-plane';
import {
  agentMessage,
  decodeControlPlaneMessage,
  openAgentStream,
  type DesiredState,
  type Envelope,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { createCsr, generateKeyPair } from '@forepath/loadweaver/shared/util-pki';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../bootstrap';

/**
 * Horizontal autoscaling (3.23, M6 step 6) against simulated agents with injected metrics (`lw_metrics` rows): the
 * autoscaler scales up within the project quota (placements, audit, event), holds without metrics, scales down only
 * after the stabilisation window and newest replicas first, and plans show / respect the autoscaled counts.
 */

const API_KEY = 'integration-test-api-key';
const WG_KEYS = ['yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=', 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg='];
const IMAGE = `ghcr.io/acme/app@sha256:${'5'.repeat(64)}`;
const SERVICE = 'shop/web/api';

const hello = (nodeName: string, key: string) => ({
  nodeName,
  agentVersion: '0.0.0-it',
  os: { id: 'debian', versionId: '13', kernel: '6.12.0', arch: 'amd64' as const },
  capabilities: {
    runtimes: ['runc' as const],
    sandboxProbe: 'missing' as const,
    wireguard: true,
    nftables: true,
    bird: true,
    drbd: false,
    criu: false,
  },
  capacity: { cpuMillis: 4000, memoryBytes: 8_000_000_000, diskBytes: 100_000_000_000 },
  wireguardPublicKey: key,
  endpointHost: `${nodeName}.example.test`,
  appliedRevision: 0,
});

const documents = (
  label = 'v1',
  autoscale = '{ min: 2, max: 8, metric: cpu, target: 50 }',
) => `apiVersion: loadweaver.com/v1
kind: Project
metadata: { name: shop }
spec:
  quota: { cpu: '1.5' }
---
apiVersion: loadweaver.com/v1
kind: Deployment
metadata: { name: web, project: shop }
spec:
  compose: |
    services:
      api:
        image: ${IMAGE}
        labels: { release: ${label} }
        deploy:
          resources:
            reservations: { cpus: '0.25', memory: 64m }
        x-loadweaver:
          autoscale: ${autoscale}
`;

describe('autoscaling (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let dataSource: DataSource;
  let autoscaler: AutoscalerService;
  const closers: (() => void)[] = [];
  const states = new Map<string, DesiredState[]>();
  /** Simulated "now" of the autoscaler; metrics are injected relative to it. */
  let now = Date.now();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary JSON response bodies
  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();

    return { status: res.status, json: text ? JSON.parse(text) : null };
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const waitFor = async <T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> => {
    const start = Date.now();

    for (;;) {
      const value = await fn();

      if (value !== undefined) return value;

      if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${fn.toString().slice(0, 300)}`);

      await sleep(200);
    }
  };

  const applyPlan = async (id: string) => {
    expect((await api('POST', `/plans/${id}/apply`, { confirm: true })).json.status).toMatch(/^(applying|applied)$/);
    await waitFor(async () => ((await api('GET', `/plans/${id}`)).json.status === 'applied' ? true : undefined));
  };

  const replicas = async () =>
    (
      (await dataSource.query(
        `SELECT id, node FROM lw_workload_placements WHERE project = 'shop' AND service = 'api' AND drain_until IS NULL ORDER BY id`,
      )) as { id: string; node: string }[]
    ).map((r) => r.id);

  /** Replicas removed by a scale-down that still drain (two-phase removal) with their deadline. */
  const draining = async () =>
    (await dataSource.query(
      `SELECT id, drain_until FROM lw_workload_placements WHERE project = 'shop' AND service = 'api' AND drain_until IS NOT NULL ORDER BY id`,
    )) as { id: string; drain_until: Date }[];

  /** CPU samples (cores) of every replica, every 10 s over the minute before the simulated now. */
  const injectCpu = async (cores: number) => {
    const rows = (await dataSource.query(
      `SELECT id, node FROM lw_workload_placements WHERE project = 'shop' AND service = 'api'`,
    )) as { id: string; node: string }[];

    for (const r of rows)
      for (let s = 5; s < 60; s += 10)
        await dataSource.query(
          `INSERT INTO lw_metrics ("time", metric, node, project, entity, value) VALUES ($1, 'replica.cpu_cores', $2, 'shop', $3, $4)`,
          [new Date(now - s * 1000), r.node, r.id, cores],
        );
  };

  const status = async () => {
    const list = (await api('GET', '/autoscaling?project=shop')).json as {
      id: string;
      replicas: number;
      desiredReplicas: number;
      min: number;
      max: number;
      status: { action: string; reason: string; blocked: string | null; value: number | null } | null;
      lastReason: string | null;
    }[];

    return list.find((s) => s.id === SERVICE);
  };

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    dataSource = app.get(DataSource);
    autoscaler = app.get(AutoscalerService);
    // The test steps through minutes in single ticks: no cooldowns, the real stabilisation window.
    autoscaler.timing = { ...DEFAULT_AUTOSCALE_TIMING, upCooldownMs: 0, downCooldownMs: 0 };

    for (const [i, node] of ['n1', 'n2'].entries()) {
      const token = (await api('POST', '/join-tokens', {})).json.token as string;
      const keys = await generateKeyPair();
      const res = await api('POST', '/nodes/join', {
        token,
        nodeName: node,
        csrPem: await createCsr(keys, node),
        hello: hello(node, WG_KEYS[i]),
      });

      expect(res.status).toBe(200);

      const { client, stream } = openAgentStream(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, {
        caCertificatePem: res.json.caCertificatePem,
        certificatePem: res.json.certificatePem,
        privateKeyPem: keys.privateKeyPem,
      });
      let applied = 0;
      const heartbeat = setInterval(
        () =>
          stream.write(
            agentMessage('heartbeat', {
              appliedRevision: applied,
              usage: { cpuMillis: 100, memoryBytes: 1_000_000, diskBytes: 1_000_000 },
              at: new Date().toISOString(),
            }),
          ),
        3_000,
      );

      stream.on('error', () => undefined);
      stream.on('data', (env: Envelope) => {
        const decoded = decodeControlPlaneMessage(env);

        if (decoded.ok === false || decoded.message.type !== 'desiredState') return;

        const state = decoded.message.payload as DesiredState;

        states.set(node, [...(states.get(node) ?? []), state]);
        applied = state.revision;
        stream.write(agentMessage('applyReport', { revision: state.revision, status: 'applied', steps: [] }));
      });
      stream.write(agentMessage('hello', hello(node, WG_KEYS[i])));
      closers.push(() => {
        clearInterval(heartbeat);
        stream.end();
        client.close();
      });
    }

    await waitFor(async () =>
      ((await dataSource.query(`SELECT count(*)::int AS n FROM lw_nodes WHERE connected`)) as { n: number }[])[0].n ===
      2
        ? true
        : undefined,
    );
  });

  afterAll(async () => {
    closers.forEach((c) => c());
    await app?.close();
  });

  it('rejects requests-based autoscaling without an HTTP exposure', async () => {
    const res = await api('POST', '/plans', {
      documents: documents('v1', '{ min: 1, max: 4, metric: requests, target: 20 }'),
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).toContain('expose the service over HTTP to autoscale on requests');
  });

  it('plans min replicas, checks the quota against min and warns that max exceeds it', async () => {
    const plan = await api('POST', '/plans', { documents: documents() });

    expect(plan.status).toBeLessThan(300);
    expect((plan.json.workloadChanges as { action: string }[]).filter((c) => c.action === 'start')).toHaveLength(2);

    const warnings = plan.json.warnings as { level: string; message: string; path?: string }[];

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          path: 'services.api.x-loadweaver.autoscale',
          message: 'autoscaled 2 (2..8), cpu target 50 % of the request',
        }),
        expect.objectContaining({
          level: 'warning',
          message:
            'at max replicas, autoscaled services exceed the quota: CPU 2 would exceed 1.5; the autoscaler stops at the quota',
        }),
      ]),
    );

    await applyPlan(plan.json.id);
    expect(await replicas()).toEqual(['shop/web/api/0', 'shop/web/api/1']);
  });

  it('holds while metrics are missing', async () => {
    expect(await autoscaler.tick(now)).toEqual([]);
    expect((await status())?.status).toMatchObject({
      action: 'hold',
      reason: 'holding: no cpu samples of its replicas in the last minute',
      value: null,
    });
  });

  it('scales up on CPU: placements, audit, event, desired states', async () => {
    now += 15_000;
    // 0.25 cores of a 0.25 request = 100 % against a 50 % target → 2 × 100 / 50 = 4.
    await injectCpu(0.25);

    expect(await autoscaler.tick(now)).toEqual([
      { service: SERVICE, from: 2, to: 4, reason: '2 → 4: cpu 100 % / target 50 %' },
    ]);
    expect(await replicas()).toEqual(['shop/web/api/0', 'shop/web/api/1', 'shop/web/api/2', 'shop/web/api/3']);

    const [audit] = await dataSource.query(
      `SELECT target, project, details FROM lw_audit_events WHERE action = 'workload.autoscaled' ORDER BY seq`,
    );

    expect(audit).toMatchObject({
      target: `service/${SERVICE}`,
      project: 'shop',
      details: { from: 2, to: 4, metric: 'cpu', value: 100, target: 50, reason: 'cpu 100 % / target 50 %' },
    });
    expect(
      await dataSource.query(`SELECT kind, entity, project, message FROM lw_events WHERE kind = 'autoscale'`),
    ).toEqual([
      {
        kind: 'autoscale',
        entity: SERVICE,
        project: 'shop',
        message: `${SERVICE} scaled 2 → 4: cpu 100 % / target 50 %`,
      },
    ]);
    // New replicas spread over both nodes and reach the agents.
    await waitFor(async () => {
      const ids = [...states.values()].flatMap((list) => (list.at(-1)?.workloads ?? []).map((w) => w.id));

      return ids.filter((id) => id.startsWith(`${SERVICE}/`)).length === 4 ? true : undefined;
    });
  });

  it('stops at the project quota and reports why', async () => {
    now += 15_000;
    await injectCpu(0.25);

    // Wants 8, the quota (1.5 CPU / 0.25) allows 6.
    expect(await autoscaler.tick(now)).toEqual([
      {
        service: SERVICE,
        from: 4,
        to: 6,
        reason: '4 → 6: cpu 100 % / target 50 % (limited: project shop quota: CPU 1.75 would exceed 1.5)',
      },
    ]);

    now += 15_000;
    await injectCpu(0.25);
    expect(await autoscaler.tick(now)).toEqual([]);
    expect(await status()).toMatchObject({
      replicas: 6,
      desiredReplicas: 6,
      min: 2,
      max: 8,
      status: { action: 'hold', blocked: 'project shop quota: CPU 1.75 would exceed 1.5' },
    });
  });

  it('plans of the deployment keep the autoscaled count', async () => {
    const plan = await api('POST', '/plans', { documents: documents('v2') });

    expect(plan.status).toBeLessThan(300);
    // No replica changes (informational volume `copy` entries, M6 gate, aren't replica changes; none here anyway).
    expect((plan.json.workloadChanges as { action: string }[]).filter((c) => c.action !== 'copy')).toEqual([]);
    expect(plan.json.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'autoscaled 6 (2..8), cpu target 50 % of the request' }),
      ]),
    );
    await applyPlan(plan.json.id);
    expect(await replicas()).toHaveLength(6);
  });

  it('shows the autoscaling on the map', async () => {
    const topology = await api('GET', '/topology');
    const replica = (topology.json.elements as { id: string; data: Record<string, unknown> }[]).find(
      (e) => e.id === `replica:${SERVICE}/0`,
    );

    expect(replica?.data).toMatchObject({ autoscaled: '6 (2..8)', autoscaleBlocked: expect.stringContaining('quota') });
    expect(String(replica?.data['lastScaled'])).toContain('4 → 6');
  });

  it('scales down only after the stabilisation window, newest replicas first', async () => {
    const start = now;

    // 0.025 cores = 10 % → recommends 2 (the first tick still averages in the busy samples: 6); while the window
    // holds a higher recommendation (the quota-blocked 8, then that 6) it only stabilises.
    for (let seconds = 30; seconds <= 270; seconds += 30) {
      now = start + seconds * 1000;
      await injectCpu(0.025);
      expect(await autoscaler.tick(now)).toEqual([]);
    }

    expect((await status())?.status?.reason).toContain('stabilising, scale-down to 2 once lower for 5 min');

    // 5 minutes after the 6: everything in the window says 2.
    now = start + 345_000;
    await injectCpu(0.025);

    const [action] = await autoscaler.tick(now);

    expect(action).toMatchObject({ service: SERVICE, from: 6, to: 2 });
    expect(await replicas()).toEqual(['shop/web/api/0', 'shop/web/api/1']);

    // Two-phase removal: the newest four drain first (default stop grace 10 s), then the drain controller deletes them.
    const drains = await draining();

    expect(drains.map((d) => d.id)).toEqual(['shop/web/api/2', 'shop/web/api/3', 'shop/web/api/4', 'shop/web/api/5']);

    for (const d of drains) {
      expect(new Date(d.drain_until).getTime()).toBeGreaterThan(Date.now());
      expect(new Date(d.drain_until).getTime()).toBeLessThanOrEqual(Date.now() + 10_000);
    }

    expect((await status())?.replicas).toBe(2);

    // While they drain, the deployment status and the map show them as `draining` (M6 gate).
    const deploymentStatus = (await api('GET', '/projects/shop/deployments/web/status')).json as {
      replicas: { id: string; state: string; drainUntil?: string }[];
    };

    expect(
      deploymentStatus.replicas.filter((r) => r.state === 'draining').map((r) => [r.id, typeof r.drainUntil]),
    ).toEqual(drains.map((d) => [d.id, 'string']));
    expect(deploymentStatus.replicas.filter((r) => r.state !== 'draining').map((r) => r.id)).toEqual([
      'shop/web/api/0',
      'shop/web/api/1',
    ]);

    const mapReplicas = (
      (await api('GET', '/topology')).json.elements as { id: string; data: Record<string, unknown> }[]
    )
      .filter((e) => e.id.startsWith(`replica:${SERVICE}/`))
      .map((e) => [e.id, e.data['state'] === 'draining' && e.data['draining'] === true]);

    expect(mapReplicas).toEqual(expect.arrayContaining(drains.map((d) => [`replica:${d.id}`, true])));
    await waitFor(async () => ((await draining()).length === 0 ? true : undefined), 30_000);
    expect(await replicas()).toEqual(['shop/web/api/0', 'shop/web/api/1']);
    expect(
      (
        await dataSource.query(
          `SELECT details FROM lw_audit_events WHERE action = 'workload.autoscaled' ORDER BY seq DESC LIMIT 1`,
        )
      )[0].details,
    ).toMatchObject({ from: 6, to: 2, metric: 'cpu', value: 10 });
  }, 60_000);

  it('changes to min / max go through plans; disabling autoscaling drops the state', async () => {
    const plan = await api('POST', '/plans', {
      documents: documents('v3', '{ min: 3, max: 5, metric: cpu, target: 50 }'),
    });

    expect(
      (plan.json.workloadChanges as { action: string; replica: string }[]).map((c) => [c.action, c.replica]),
    ).toEqual([['start', 'shop/web/api/2']]);
    await applyPlan(plan.json.id);
    expect(await replicas()).toHaveLength(3);

    const off = await api('POST', '/plans', {
      documents: documents('v4', '{ min: 3, max: 5, metric: cpu, target: 50 }').replace(
        /x-loadweaver:\n\s+autoscale: .*\n/,
        'x-loadweaver: { replicas: 1 }\n',
      ),
    });

    await applyPlan(off.json.id);
    await autoscaler.tick(now + 15_000);
    expect(await dataSource.query(`SELECT * FROM lw_autoscale_state`)).toEqual([]);
    expect(await status()).toBeUndefined();
  });

  it("scales on requests per replica and on a custom metric of the service's hostnames", async () => {
    const plan = await api('POST', '/plans', {
      documents: `apiVersion: loadweaver.com/v1
kind: Project
metadata: { name: blog }
spec: {}
---
apiVersion: loadweaver.com/v1
kind: Deployment
metadata: { name: site, project: blog }
spec:
  compose: |
    services:
      front:
        image: ${IMAGE}
        x-loadweaver:
          exposure: { http: [{ host: blog.example.test, port: 80 }] }
          autoscale: { min: 1, max: 4, metric: requests, target: 10 }
      edge:
        image: ${IMAGE}
        x-loadweaver:
          exposure: { http: [{ host: edge.example.test, port: 80 }] }
          autoscale: { min: 1, max: 4, metric: custom, customMetric: ingress.latency_p95_ms, target: 200 }
`,
    });

    expect(plan.status).toBeLessThan(300);
    await applyPlan(plan.json.id);

    now += 60_000;

    // No samples while no node reports metrics at all: hold.
    expect(await autoscaler.tick(now)).toEqual([]);
    expect(
      ((await api('GET', '/autoscaling?project=blog')).json as { id: string; status: { reason: string } }[]).map(
        (x) => [x.id, x.status.reason],
      ),
    ).toEqual([
      [
        'blog/site/edge',
        'holding: no ingress.latency_p95_ms samples for the service, its replicas or hostnames in the last minute',
      ],
      ['blog/site/front', 'holding: no metrics reported by any node in the last minute'],
    ]);

    // Two ingress nodes see 15 req/s each for the front (30 / 1 replica vs. 10 → 3), p95 400 / 300 ms for the edge
    // (the worst: 400 vs. 200 → 2).
    for (const [node, rate, p95] of [
      ['n1', 15, 400],
      ['n2', 15, 300],
    ] as const)
      for (let sec = 5; sec < 60; sec += 10) {
        await dataSource.query(
          `INSERT INTO lw_metrics ("time", metric, node, project, entity, value) VALUES ($1, 'ingress.requests_per_s', $2, NULL, 'blog.example.test', $3)`,
          [new Date(now - sec * 1000), node, rate],
        );
        await dataSource.query(
          `INSERT INTO lw_metrics ("time", metric, node, project, entity, value) VALUES ($1, 'ingress.latency_p95_ms', $2, NULL, 'edge.example.test', $3)`,
          [new Date(now - sec * 1000), node, p95],
        );
      }

    expect(await autoscaler.tick(now)).toEqual([
      { service: 'blog/site/front', from: 1, to: 3, reason: '1 → 3: requests 30/s / target 10/s per replica' },
      { service: 'blog/site/edge', from: 1, to: 2, reason: '1 → 2: ingress.latency_p95_ms 400 / target 200' },
    ]);
  });
});
