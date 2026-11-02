import { readdirSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join as joinPath } from 'node:path';

import { MigrationSessionService, WorkloadControllerService } from '@forepath/loadweaver/backend/feature-control-plane';
import {
  agentMessage,
  decodeControlPlaneMessage,
  openAgentStream,
  PROTOCOL_VERSION,
  type DesiredState,
  type Envelope,
  type MigrationProgress,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { checkJsonSchema, type JsonSchemaObject } from '@forepath/loadweaver/shared/util-json-schema';
import { createCsr, generateKeyPair } from '@forepath/loadweaver/shared/util-pki';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../bootstrap';

/**
 * Live migration, control-plane side (3.10, M6 step 1) against simulated agents: n1 / n2 speak protocol v2 with
 * `live-migration` and checkpoint support, n3 is an agent built before versioning. The simulated v2 agents answer
 * every migration command like the agent-side checkpoint manager will (restores on demand fail for one replica).
 */

const API_KEY = 'integration-test-api-key';
const WG_KEYS = [
  'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=',
  'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=',
  'HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw=',
];
const IMAGE = `ghcr.io/acme/app@sha256:${'7'.repeat(64)}`;

const hello = (nodeName: string, key: string, live: boolean) => ({
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
    criu: live,
    ...(live ? { checkpoint: { runc: true, runsc: false, criuVersion: '4.1.1' } } : {}),
  },
  capacity: { cpuMillis: 4000, memoryBytes: 8_000_000_000, diskBytes: 100_000_000_000 },
  wireguardPublicKey: key,
  endpointHost: `${nodeName}.example.test`,
  appliedRevision: 0,
  ...(live ? { protocolVersion: PROTOCOL_VERSION, features: ['live-migration'] } : {}),
});

/** The legacy agent (n3) must only ever get messages of the latest frozen protocol (N-1). */
const PROTOCOL_COMPAT_DIR = joinPath(
  __dirname,
  '../../../../../libs/domains/loadweaver/shared/util-agent-protocol/src/compat',
);
const N1_PROTOCOL = (() => {
  const latest = Math.max(
    ...readdirSync(PROTOCOL_COMPAT_DIR)
      .filter((d) => /^v\d+$/.test(d))
      .map((d) => Number(d.slice(1))),
  );

  return JSON.parse(readFileSync(joinPath(PROTOCOL_COMPAT_DIR, `v${latest}`, 'control-plane-to-agent.json'), 'utf8'))
    .messages as Record<string, JsonSchemaObject>;
})();

interface SimulatedAgent {
  node: string;
  received: { type: string; channel?: string; payload: Record<string, unknown> }[];
  states: DesiredState[];
  violations: string[];
  report(workloads: { id: string; state: 'running' | 'healthy' }[]): void;
  close(): void;
}

describe('live migration (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let dataSource: DataSource;
  const agents = new Map<string, SimulatedAgent>();
  /** Replicas whose restore the simulated target fails. */
  const failRestore = new Set<string>();
  /** Replicas whose target answers prepare with another node's address (it must not count). */
  const forgedEndpoint = new Set<string>();
  /** Every migration command any agent received, in arrival order: `node:type:replica[:role]`. */
  const commandLog: string[] = [];

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

  /** Applies a plan (confirming its pins) and waits until the nodes applied it. */
  const applyPlan = async (id: string) => {
    expect((await api('POST', `/plans/${id}/apply`, { confirm: true })).json.status).toMatch(/^(applying|applied)$/);
    await waitFor(async () => ((await api('GET', `/plans/${id}`)).json.status === 'applied' ? true : undefined));
  };

  const waitFor = async <T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> => {
    const start = Date.now();

    for (;;) {
      const value = await fn();

      if (value !== undefined) return value;

      if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${fn.toString().slice(0, 300)}`);

      await sleep(200);
    }
  };

  /** Drives the control plane: send due commands, let the agents answer, tick, until `done` holds. */
  const drive = async (done: () => Promise<boolean>, rounds = 60): Promise<void> => {
    const sessions = app.get(MigrationSessionService);
    const controller = app.get(WorkloadControllerService);

    for (let i = 0; i < rounds; i++) {
      if (await done()) return;

      await sessions.sendDue();
      await sleep(250);
      await controller.tick();
    }

    throw new Error('migration did not reach the expected state');
  };

  const connect = (node: string, credentials: Parameters<typeof openAgentStream>[1], live: boolean): SimulatedAgent => {
    const { client, stream } = openAgentStream(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, credentials);
    // Heartbeats keep the node reachable (a lost source or target aborts a migration).
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
    const agent: SimulatedAgent = {
      node,
      received: [],
      states: [],
      violations: [],
      report: (workloads) =>
        stream.write(agentMessage('workloadStatus', { workloads: workloads.map((w) => ({ ...w, specHash: 'x' })) })),
      close: () => {
        clearInterval(heartbeat);
        stream.end();
        client.close();
      },
    };
    const progress = (
      channel: string | undefined,
      base: { migration: string; attempt: number; replica: string },
      rest: Omit<MigrationProgress, 'migration' | 'attempt' | 'replica'>,
    ) => stream.write(agentMessage('migrationProgress', { ...base, ...rest }, { channel }));

    stream.on('error', () => undefined);
    stream.on('data', (env: Envelope) => {
      if (!live) {
        const schema = N1_PROTOCOL[env.type];

        if (!schema) agent.violations.push(`${env.type}: unknown to N-1 agents`);
        else
          for (const issue of checkJsonSchema(schema, JSON.parse(Buffer.from(env.payload).toString('utf8'))))
            agent.violations.push(`${env.type}.${issue.path.join('.')}: ${issue.message}`);
      }

      const decoded = decodeControlPlaneMessage(env);

      if (decoded.ok === false) {
        agent.violations.push(decoded.error);

        return;
      }

      const { type, payload } = decoded.message;

      agent.received.push({ type, channel: env.channel, payload: payload as Record<string, unknown> });

      if (type === 'desiredState') {
        agent.states.push(payload as DesiredState);
        applied = (payload as DesiredState).revision;
        stream.write(
          agentMessage('applyReport', { revision: (payload as DesiredState).revision, status: 'applied', steps: [] }),
        );

        return;
      }

      if (!type.startsWith('migration')) return;

      commandLog.push(
        [node, type, (payload as { replica: string }).replica, (payload as { role?: string }).role]
          .filter(Boolean)
          .join(':'),
      );

      // A checkpoint manager that does what it is told (the real one is the agent-side step).
      const p = payload as { migration: string; attempt: number; replica: string; role?: string };
      const base = { migration: p.migration, attempt: p.attempt, replica: p.replica };

      switch (type) {
        case 'migrationPrepare':
          progress(env.channel, base, {
            phase: 'prepare',
            status: 'done',
            endpoint: {
              address: (node === 'n1') !== forgedEndpoint.has(p.replica) ? '10.93.0.1' : '10.93.0.2',
              port: 7480,
            },
          });
          break;
        case 'migrationPrecopy':
          progress(env.channel, base, { phase: 'precopy', status: 'running', round: 1, bytes: 150_000_000 });
          progress(env.channel, base, {
            phase: 'precopy',
            status: 'done',
            round: 3,
            totalBytes: 150_400_000,
            dirtyBytesPerSecond: 800_000,
          });
          break;
        case 'migrationFreeze':
          progress(env.channel, base, { phase: 'freeze', status: 'done' });
          progress(env.channel, base, { phase: 'transfer', status: 'done', totalBytes: 150_732_000 });
          break;
        case 'migrationRestore':
          if (failRestore.has(p.replica)) {
            progress(env.channel, base, { phase: 'restore', status: 'failed', error: 'criu restore failed' });
          } else {
            progress(env.channel, base, { phase: 'restore', status: 'done', freezeMs: 480 });
            agent.report([{ id: p.replica, state: 'running' }]);
          }
          break;
        case 'migrationCommit':
          progress(env.channel, base, { phase: 'commit', status: 'done' });
          break;
        case 'migrationAbort':
          progress(env.channel, base, { phase: 'abort', status: 'done', resumed: p.role === 'source' });
          break;
      }
    });
    stream.write(agentMessage('hello', hello(node, WG_KEYS[['n1', 'n2', 'n3'].indexOf(node)], live)));
    agents.set(node, agent);

    return agent;
  };

  const migrationsOf = async (replica: string) =>
    (await api('GET', `/migrations?replica=${encodeURIComponent(replica)}`)).json as {
      method: string;
      methodLabel: string;
      attempt: number;
      phase: string;
      fallbackReason: string | null;
      freezeMs: number | null;
      checkpointBytes: number | null;
      precopyRounds: number | null;
      fromNode: string;
      toNode: string;
      finishedAt: string | null;
    }[];

  const placement = async (id: string) =>
    (
      await dataSource.query(
        `SELECT node, addresses, target_node, target_addresses, migration, restored FROM lw_workload_placements WHERE id = $1`,
        [id],
      )
    )[0] as {
      node: string;
      addresses: string[];
      target_node: string | null;
      target_addresses: string[];
      migration: { method: string; phase: string; after?: string[]; label?: string } | null;
      restored: { migration: string; runtime: string } | null;
    };

  const desiredWorkloads = async (node: string) =>
    ((await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = $1`, [node]))[0]?.state
      ?.workloads ?? []) as { id: string; restoredFrom?: unknown; hostRoutes?: string[] }[];

  const deployment = (selectors: Record<string, string>) => `apiVersion: loadweaver.com/v1
kind: Project
metadata: { name: shop }
spec: {}
---
apiVersion: loadweaver.com/v1
kind: Deployment
metadata: { name: live, project: shop }
spec:
  compose: |
    services:
      api:
        image: ${IMAGE}
        x-loadweaver: { placement: { selector: { names: [${selectors['api']}] } } }
      web:
        image: ${IMAGE}
        depends_on: [api]
        x-loadweaver: { placement: { selector: { names: [${selectors['web']}] } } }
      cache:
        image: ${IMAGE}
        x-loadweaver: { placement: { selector: { names: [${selectors['cache']}] } } }
      old:
        image: ${IMAGE}
        x-loadweaver: { placement: { selector: { names: [${selectors['old']}] } } }
`;

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    dataSource = app.get(DataSource);

    for (const [i, node] of ['n1', 'n2', 'n3'].entries()) {
      const token = (await api('POST', '/join-tokens', {})).json.token as string;
      const keys = await generateKeyPair();
      const res = await api('POST', '/nodes/join', {
        token,
        nodeName: node,
        csrPem: await createCsr(keys, node),
        hello: hello(node, WG_KEYS[i], node !== 'n3'),
      });

      expect(res.status).toBe(200);
      connect(
        node,
        {
          caCertificatePem: res.json.caCertificatePem,
          certificatePem: res.json.certificatePem,
          privateKeyPem: keys.privateKeyPem,
        },
        node !== 'n3',
      );
    }

    await waitFor(async () => {
      const rows: { name: string; protocol_features: string[] }[] = await dataSource.query(
        `SELECT name, protocol_features FROM lw_nodes WHERE connected ORDER BY name`,
      );

      return rows.length === 3 && rows[0].protocol_features.includes('live-migration') ? true : undefined;
    });
  });

  afterAll(async () => {
    agents.forEach((a) => a.close());
    await app?.close();
  });

  it('records the negotiated protocol of every node', async () => {
    expect(
      await dataSource.query(`SELECT name, protocol_version, protocol_features FROM lw_nodes ORDER BY name`),
    ).toEqual([
      { name: 'n1', protocol_version: PROTOCOL_VERSION, protocol_features: ['live-migration'] },
      { name: 'n2', protocol_version: PROTOCOL_VERSION, protocol_features: ['live-migration'] },
      { name: 'n3', protocol_version: 0, protocol_features: [] },
    ]);
  });

  it('plans the method per service: live between capable nodes, blue / green with the reason towards a v1 agent', async () => {
    const first = await api('POST', '/plans', {
      documents: deployment({ api: 'n1', web: 'n1', cache: 'n1', old: 'n1' }),
    });

    await applyPlan(first.json.id);
    // What runs on n1 is compiled into its desired state (the target prepares exactly that spec).
    await waitFor(async () => ((await desiredWorkloads('n1')).length === 4 ? true : undefined));
    agents.get('n1')?.report(['api', 'web', 'cache', 'old'].map((s) => ({ id: `shop/live/${s}/0`, state: 'running' })));

    const plan = await api('POST', '/plans', {
      documents: deployment({ api: 'n2', web: 'n2', cache: 'n1', old: 'n3' }),
    });
    const moves = Object.fromEntries(
      (plan.json.workloadChanges as { replica: string; method: string; methodLabel: string }[]).map((c) => [
        c.replica,
        [c.method, c.methodLabel],
      ]),
    );

    expect(moves).toEqual({
      'shop/live/api/0': ['live', 'live'],
      'shop/live/web/0': ['live', 'live'],
      'shop/live/old/0': ['blue-green', 'blue-green (agent on n3 does not support live migration)'],
    });

    await applyPlan(plan.json.id);

    // Dependency waves: web waits for api; the blue / green move starts right away.
    expect((await placement('shop/live/api/0')).migration).toMatchObject({ method: 'live', phase: 'prepare' });
    expect((await placement('shop/live/web/0')).migration).toMatchObject({
      method: 'live',
      phase: 'queued',
      after: ['shop/live/api/0'],
    });
    expect((await placement('shop/live/old/0')).migration).toMatchObject({ method: 'blue-green', phase: 'starting' });
  });

  it('migrates live through every phase, keeps the address and records the attempt', async () => {
    const before = await placement('shop/live/api/0');

    // The live target keeps the replica's address.
    expect(before.target_addresses).toEqual(before.addresses);

    await drive(async () => (await migrationsOf('shop/live/api/0'))[0]?.phase === 'done');

    const after = await placement('shop/live/api/0');

    expect(after).toMatchObject({ node: 'n2', addresses: before.addresses, target_node: null, migration: null });
    expect(after.restored).toMatchObject({ runtime: 'runc' });

    const [row] = await migrationsOf('shop/live/api/0');

    expect(row).toMatchObject({
      method: 'live',
      attempt: 1,
      fromNode: 'n1',
      toNode: 'n2',
      fallbackReason: null,
      freezeMs: 480,
      checkpointBytes: 150_732_000,
      precopyRounds: 3,
    });
    expect(row.finishedAt).not.toBeNull();

    // Commands in order, each on the session channel; prepare / restore to the target, the rest to the source.
    const sessionTypes = (node: string) =>
      agents
        .get(node)
        ?.received.filter((m) => m.type.startsWith('migration') && m.payload['replica'] === 'shop/live/api/0')
        .map((m) => m.type);

    expect([...new Set(sessionTypes('n2'))]).toEqual(['migrationPrepare', 'migrationRestore', 'migrationCommit']);
    expect([...new Set(sessionTypes('n1'))]).toEqual(['migrationPrecopy', 'migrationFreeze', 'migrationCommit']);
    expect(agents.get('n2')?.received.find((m) => m.type === 'migrationPrepare')?.channel).toMatch(
      /^migration:[0-9a-f-]{36}$/,
    );

    // The restored replica: agent-managed on n2 with its kept address as a host route, announced by n2's BIRD.
    await waitFor(async () => {
      const w = (await desiredWorkloads('n2')).find((x) => x.id === 'shop/live/api/0');

      return w?.restoredFrom ? w : undefined;
    });

    const restored = (await desiredWorkloads('n2')).find((x) => x.id === 'shop/live/api/0');

    expect(restored?.hostRoutes).toEqual(before.addresses.map((a) => (a.includes(':') ? `${a}/128` : `${a}/32`)));
    expect((await desiredWorkloads('n1')).some((x) => x.id === 'shop/live/api/0')).toBe(false);

    const n2State = await waitFor(async () =>
      agents
        .get('n2')
        ?.states.find(
          (s) =>
            s.network.bgp.originate.includes(`${before.addresses[0]}/32`) && s.workloads.some((w) => w.restoredFrom),
        ),
    );

    expect(n2State.workloads.find((w) => w.id === 'shop/live/api/0')?.restoredFrom).toBeDefined();

    // History on the timeline and in the audit log.
    expect(
      (
        await dataSource.query(
          `SELECT message FROM lw_events WHERE kind = 'migration' AND entity = 'shop/live/api/0' ORDER BY "time"`,
        )
      ).map((r: { message: string }) => r.message),
    ).toEqual([
      'shop/live/api/0: live migration n1 → n2 started (attempt 1)',
      'shop/live/api/0: live migration n1 → n2 cut over',
      'shop/live/api/0: live migration done',
    ]);
    expect(
      await dataSource.query(
        `SELECT details->>'method' AS method FROM lw_audit_events WHERE action = 'workload.migrated' AND target = 'workload/shop/live/api/0'`,
      ),
    ).toEqual([{ method: 'live' }]);
  });

  it('starts the next wave once the previous target runs', async () => {
    agents.get('n2')?.report([{ id: 'shop/live/api/0', state: 'running' }]);
    await drive(async () => (await migrationsOf('shop/live/web/0'))[0]?.phase === 'done');
    expect(await placement('shop/live/web/0')).toMatchObject({ node: 'n2', migration: null });

    // The blue / green move to the v1 node finishes as before.
    agents.get('n3')?.report([{ id: 'shop/live/old/0', state: 'running' }]);
    await drive(async () => (await placement('shop/live/old/0')).node === 'n3');
    expect(await migrationsOf('shop/live/old/0')).toEqual([
      expect.objectContaining({ method: 'blue-green', phase: 'done', attempt: 1 }),
    ]);
  });

  it('falls back after a failed restore: target aborted first, source resumed, then blue / green', async () => {
    failRestore.add('shop/live/cache/0');

    const before = await placement('shop/live/cache/0');
    const plan = await api('POST', '/plans', {
      documents: deployment({ api: 'n2', web: 'n2', cache: 'n2', old: 'n3' }),
    });

    expect(plan.json.workloadChanges).toEqual([
      expect.objectContaining({ replica: 'shop/live/cache/0', method: 'live', methodLabel: 'live' }),
    ]);
    await applyPlan(plan.json.id);

    await drive(async () => (await placement('shop/live/cache/0')).migration?.method === 'blue-green');

    // The source kept running the replica the whole time (never killed before the target runs).
    expect((await desiredWorkloads('n1')).some((x) => x.id === 'shop/live/cache/0')).toBe(true);

    // The target discards first; only then the source resumes.
    expect(commandLog.filter((c) => c.includes('shop/live/cache/0') && c.includes('Abort'))).toEqual([
      'n2:migrationAbort:shop/live/cache/0:target',
      'n1:migrationAbort:shop/live/cache/0:source',
    ]);
    expect(commandLog.filter((c) => c.includes('shop/live/cache/0') && !c.includes('Abort'))).toEqual([
      'n2:migrationPrepare:shop/live/cache/0',
      'n1:migrationPrecopy:shop/live/cache/0',
      'n1:migrationFreeze:shop/live/cache/0',
      'n2:migrationRestore:shop/live/cache/0',
    ]);

    const fallback = await placement('shop/live/cache/0');

    // Blue / green needs its own address on the target.
    expect(fallback.target_addresses[0]).toMatch(/^10\.88\.1\./);
    expect(fallback.migration?.label).toBe('blue-green (fallback: target restore failed: criu restore failed)');

    agents.get('n2')?.report([
      { id: 'shop/live/api/0', state: 'running' },
      { id: 'shop/live/web/0', state: 'running' },
      { id: 'shop/live/cache/0', state: 'running' },
    ]);
    await drive(async () => (await placement('shop/live/cache/0')).node === 'n2');

    expect(
      (await migrationsOf('shop/live/cache/0')).map((m) => [m.attempt, m.method, m.phase, m.fallbackReason]),
    ).toEqual([
      [2, 'blue-green', 'done', null],
      [1, 'live', 'fallback', 'target restore failed: criu restore failed'],
    ]);
    expect((await placement('shop/live/cache/0')).addresses).not.toEqual(before.addresses);
    expect(
      (
        await dataSource.query(
          `SELECT action FROM lw_audit_events WHERE target = 'workload/shop/live/cache/0' ORDER BY seq`,
        )
      ).map((r: { action: string }) => r.action),
    ).toEqual(['workload.migration-aborted', 'workload.migration-fallback', 'workload.migrated']);
  });

  it('lists the history scoped by project and deployment, and validates filters', async () => {
    const all = await api('GET', '/migrations?project=shop&deployment=live');

    expect(all.status).toBe(200);
    expect(all.json.map((m: { replica: string }) => m.replica).sort()).toEqual([
      'shop/live/api/0',
      'shop/live/cache/0',
      'shop/live/cache/0',
      'shop/live/old/0',
      'shop/live/web/0',
    ]);
    expect(all.json[0]).not.toHaveProperty('token');
    expect(all.json[0]).not.toHaveProperty('spec');
    expect((await api('GET', '/migrations?deployment=live')).status).toBe(400);
    expect((await api('GET', '/migrations?replica=nope')).status).toBe(400);
    expect((await api('GET', '/migrations?project=other')).json).toEqual([]);
  });

  it('aborts on a phase timeout and falls back; the kept address stays reserved for its subnet', async () => {
    const controller = app.get(WorkloadControllerService);
    const kept = (await placement('shop/live/api/0')).addresses;

    // The target points the source at another node: the report is refused and prepare times out.
    forgedEndpoint.add('shop/live/api/0');
    controller.timeouts = { ...controller.timeouts, prepare: 1_000 };

    try {
      const plan = await api('POST', '/plans', {
        documents: deployment({ api: 'n1', web: 'n2', cache: 'n2', old: 'n3' }),
      });

      expect(plan.json.workloadChanges).toEqual([
        expect.objectContaining({ replica: 'shop/live/api/0', method: 'live', from: 'n2', to: 'n1' }),
      ]);
      await applyPlan(plan.json.id);
      await drive(async () => (await placement('shop/live/api/0')).migration?.method === 'blue-green');
    } finally {
      controller.timeouts = { ...controller.timeouts, prepare: 120_000 };
    }

    expect(
      (await migrationsOf('shop/live/api/0')).slice(0, 2).map((m) => [m.method, m.phase, m.fallbackReason]),
    ).toEqual([
      ['blue-green', 'starting', null],
      ['live', 'fallback', 'prepare timed out after 1 s'],
    ]);

    // The address the replica kept from n1's subnet is still in use on n2: n1 hands out a different one.
    const fallback = await placement('shop/live/api/0');

    expect(fallback.target_addresses[0]).toMatch(/^10\.88\.0\./);
    expect(fallback.target_addresses).not.toContain(kept[0]);
  });

  it('never sent the v1 agent a live-migration message or field (3.26)', () => {
    const n3 = agents.get('n3');

    expect(n3?.violations).toEqual([]);
    expect(n3?.received.some((m) => m.type.startsWith('migration'))).toBe(false);
    expect([...agents.values()].flatMap((a) => a.violations)).toEqual([]);
  });
});
