import type { AddressInfo } from 'node:net';

import { ImportControllerService } from '@forepath/loadweaver/backend/feature-control-plane';
import {
  agentMessage,
  decodeControlPlaneMessage,
  openAgentStream,
  type DesiredState,
  type DiscoveryReport,
  type Envelope,
  type ImportStepCommand,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { createCsr, generateKeyPair } from '@forepath/loadweaver/shared/util-pki';
import { generateSealKeyPair } from '@forepath/loadweaver/shared/util-secrets';
import type { INestApplication } from '@nestjs/common';
import { parse } from 'yaml';
import { DataSource } from 'typeorm';

import { createApp } from '../bootstrap';

/**
 * Import of existing Docker hosts (3.21, M6 step 4) against simulated agents: a host joins for an import with its
 * discovery (pending: no desired state, no tunnel peer, report stored redacted), discovers again on request, the
 * wizard's selection becomes one join plan (conflicts refused with reasons) and one plan (imported deployment +
 * `NodeImport`), and applying it drives the steps — components, activation, pre-copy, stop, final pass, release,
 * verify, handover — with the deployment held until its release. A failed final pass rolls back (source restarted).
 */

const API_KEY = 'integration-test-api-key';
const WG_KEYS = [
  'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=',
  'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=',
  'ME9Hy4wZnZ8kHRc5pH2Oj2iO+3MXtFQ5rEn/8n6nQ1Q=',
];
const NGINX = 'a'.repeat(64);
const IMAGE = `docker.io/library/nginx@sha256:${'7'.repeat(64)}`;

/** Seal keys, so the first member can hold a master-key share (volume keys are secrets). */
const SEAL = new Map<string, string>();
const sealKey = (node: string) => {
  if (!SEAL.has(node)) SEAL.set(node, generateSealKeyPair().publicKey);

  return SEAL.get(node) as string;
};

const hello = (nodeName: string, key: string, features: string[] = []) => ({
  nodeName,
  sealPublicKey: sealKey(nodeName),
  agentVersion: '0.0.0-it',
  os: { id: 'debian', versionId: '13', kernel: '6.12.0', arch: 'amd64' as const },
  capabilities: {
    runtimes: ['runc' as const],
    sandboxProbe: 'missing' as const,
    wireguard: true,
    nftables: true,
    bird: true,
    drbd: true,
    drbd9: true,
    criu: false,
  },
  capacity: { cpuMillis: 4000, memoryBytes: 8_000_000_000, diskBytes: 100_000_000_000 },
  wireguardPublicKey: key,
  endpointHost: `${nodeName}.example.test`,
  appliedRevision: 0,
  hostname: nodeName,
  ...(features.length ? { protocolVersion: 2, features } : {}),
});

function discovery(host: string, overrides: Partial<DiscoveryReport> = {}): DiscoveryReport {
  return {
    version: 1,
    at: new Date().toISOString(),
    hostname: host,
    docker: { available: true, version: '29.9.1' },
    composeProjects: [
      {
        name: 'shop',
        workingDir: '/srv/shop',
        configFiles: [
          {
            path: '/srv/shop/compose.yaml',
            // An agent that forgot to redact: the control plane redacts again.
            content: `services:\n  web:\n    image: ${IMAGE}\n    ports: ["80:80"]\n    volumes: ["html:/usr/share/nginx/html"]\n    environment:\n      ADMIN_PASSWORD: s3cret-inline\nvolumes:\n  html: {}\n`,
          },
        ],
        envFile: {
          path: '/srv/shop/.env',
          variables: [{ name: 'DB_URL', value: 'postgres://u:pw@db/x', sensitive: false }],
        },
        services: ['web'],
        containers: [NGINX],
      },
    ],
    containers: [
      {
        id: NGINX,
        name: 'shop-web-1',
        image: IMAGE,
        state: 'running',
        restartPolicy: 'unless-stopped',
        ports: [{ protocol: 'tcp', hostIp: '0.0.0.0', hostPort: 80, containerPort: 80 }],
        mounts: [
          {
            type: 'volume',
            name: 'shop_html',
            source: '/var/lib/docker/volumes/shop_html/_data',
            destination: '/usr/share/nginx/html',
            readOnly: false,
          },
        ],
        networks: ['shop_default'],
        labels: { 'com.docker.compose.project': 'shop', 'com.docker.compose.service': 'web' },
        compose: { project: 'shop', service: 'web', number: 1 },
        managed: false,
      },
    ],
    volumes: [
      {
        name: 'shop_html',
        driver: 'local',
        mountpoint: '/var/lib/docker/volumes/shop_html/_data',
        sizeBytes: 4096,
        compose: { project: 'shop', volume: 'html' },
        usedBy: [NGINX],
      },
    ],
    networks: [{ name: 'shop_default', driver: 'bridge', subnets: ['172.18.0.0/16'] }],
    listeners: [
      { protocol: 'tcp', address: '0.0.0.0', port: 80, process: 'docker-proxy', pid: 99 },
      { protocol: 'udp', address: '0.0.0.0', port: 51820 },
    ],
    interfaces: [{ name: 'wg0', kind: 'wireguard', up: true, addresses: ['10.200.0.2/24'] }],
    routes: [{ destination: '10.200.0.0/24', device: 'wg0', family: 'inet' }],
    vpns: [{ interface: 'wg0', kind: 'wireguard', listenPort: 51820 }],
    nftables: [{ family: 'inet', name: 'filter' }],
    former: null,
    warnings: [],
    ...overrides,
  };
}

interface SimulatedAgent {
  states: DesiredState[];
  steps: ImportStepCommand[];
  discoveryRequests: string[];
  close: () => void;
}

describe('node import (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let dataSource: DataSource;
  let controller: ImportControllerService;
  const agents = new Map<string, SimulatedAgent>();
  /** Steps a simulated agent fails instead of finishing. */
  const failing = new Set<string>();

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
    const res = await api('POST', `/plans/${id}/apply`, { confirm: true });

    expect(res.json).toMatchObject({ status: expect.stringMatching(/^(applying|applied)$/) });
    await waitFor(async () => ((await api('GET', `/plans/${id}`)).json.status === 'applied' ? true : undefined));
  };

  /** Joins a simulated agent (normally or for an import) and keeps its stream open. */
  const join = async (node: string, key: string, report?: DiscoveryReport) => {
    const token = (await api('POST', '/join-tokens', {})).json.token as string;
    const keys = await generateKeyPair();
    const features = report ? ['node-import', 'drbd-hostnames'] : [];
    const res = await api('POST', '/nodes/join', {
      token,
      nodeName: node,
      csrPem: await createCsr(keys, node),
      hello: hello(node, key, features),
      ...(report ? { discover: true, discovery: report } : {}),
    });

    expect(res.status).toBe(200);

    const { client, stream } = openAgentStream(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, {
      caCertificatePem: res.json.caCertificatePem,
      certificatePem: res.json.certificatePem,
      privateKeyPem: keys.privateKeyPem,
    });
    const agent: SimulatedAgent = { states: [], steps: [], discoveryRequests: [], close: () => undefined };
    let applied = 0;
    const send = (env: Envelope) => stream.write(env);
    const heartbeat = setInterval(
      () =>
        send(
          agentMessage('heartbeat', {
            appliedRevision: applied,
            usage: { cpuMillis: 100, memoryBytes: 1_000_000, diskBytes: 1_000_000 },
            at: new Date().toISOString(),
          }),
        ),
      2_000,
    );

    stream.on('error', () => undefined);
    stream.on('data', (env: Envelope) => {
      const decoded = decodeControlPlaneMessage(env);

      if (decoded.ok === false) return;

      const message = decoded.message;

      if (message.type === 'desiredState') {
        const state = message.payload as DesiredState;

        agent.states.push(state);
        applied = state.revision;
        send(agentMessage('applyReport', { revision: state.revision, status: 'applied', steps: [] }));
        send(
          agentMessage('workloadStatus', {
            workloads: state.workloads.map((w) => ({ id: w.id, state: 'running' as const, specHash: 'h' })),
          }),
        );
      } else if (message.type === 'discoveryRequest') {
        agent.discoveryRequests.push(message.payload.request);
        send(
          agentMessage('discoveryReport', {
            request: message.payload.request,
            report: discovery(node, { warnings: ['refreshed'] }),
          }),
        );
      } else if (message.type === 'importStep') {
        const step = message.payload as ImportStepCommand;

        agent.steps.push(step);

        const fail = failing.has(step.step);

        send(
          agentMessage(
            'importProgress',
            {
              import: step.import,
              step: step.step,
              status: fail ? 'failed' : 'done',
              ...(fail ? { message: 'rsync: connection unexpectedly closed' } : {}),
              ...(step.action.kind === 'stop' ? { restartPolicies: { [NGINX]: 'unless-stopped' } } : {}),
              ...(step.action.kind === 'precopy' || step.action.kind === 'final-sync' ? { bytes: 4096 } : {}),
            },
            { channel: env.channel },
          ),
        );
      }
    });
    send(agentMessage('hello', hello(node, key, features)));
    agent.close = () => {
      clearInterval(heartbeat);
      stream.end();
      client.close();
    };
    agents.set(node, agent);

    return res.json as { pending?: boolean };
  };

  /** Ticks the import controller until the selection reaches one of the states. */
  const driveUntil = async (node: string, statuses: string[], timeoutMs = 60_000) =>
    await waitFor(async () => {
      await controller.tick();

      const [row] = (await dataSource.query(
        `SELECT status, steps, error FROM lw_import_selections WHERE node = $1 ORDER BY created_at DESC LIMIT 1`,
        [node],
      )) as { status: string; steps: Record<string, { status: string; message?: string }>; error: string | null }[];

      return row && statuses.includes(row.status) ? row : undefined;
    }, timeoutMs);

  beforeAll(async () => {
    process.env['LOADWEAVER_IMPORT_CONTROLLER'] = 'off';
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    dataSource = app.get(DataSource);
    controller = app.get(ImportControllerService);

    await join('n1', WG_KEYS[0]);
    await waitFor(async () =>
      ((await dataSource.query(`SELECT count(*)::int AS n FROM lw_nodes WHERE connected`)) as { n: number }[])[0].n ===
      1
        ? true
        : undefined,
    );

    const project = await api('POST', '/plans', {
      documents: 'apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: shop }\nspec: {}\n',
    });

    expect(project.status).toBe(201);
    await applyPlan(project.json.id);
  });

  afterAll(async () => {
    agents.forEach((a) => a.close());
    await app?.close();
  });

  it('joins a host for an import: pending, no desired state, no tunnel peer, redacted discovery', async () => {
    const response = await join('host1', WG_KEYS[1], discovery('host1'));

    expect(response.pending).toBe(true);

    const [node] = (await dataSource.query(`SELECT lifecycle FROM lw_nodes WHERE name = 'host1'`)) as {
      lifecycle: string;
    }[];

    expect(node.lifecycle).toBe('pending');
    // Recompiles keep happening for n1; host1 is neither compiled nor a peer.
    await sleep(3_000);
    expect(agents.get('host1')?.states).toEqual([]);
    expect(
      (await dataSource.query(`SELECT count(*)::int AS n FROM lw_node_desired_states WHERE node_name = 'host1'`))[0].n,
    ).toBe(0);
    expect(
      agents
        .get('n1')
        ?.states.at(-1)
        ?.network.wireguard.map((l) => l.peer) ?? [],
    ).not.toContain('host1');

    const [stored] = (await dataSource.query(
      `SELECT report::text AS report FROM lw_node_discoveries WHERE node = 'host1'`,
    )) as {
      report: string;
    }[];

    expect(stored.report).not.toMatch(/s3cret-inline|u:pw@/);
    expect(stored.report).toContain('${ADMIN_PASSWORD}');
    // Cordon / drain don't apply to a node waiting for its join plan.
    expect((await api('POST', '/nodes/host1/cordon')).status).toBe(409);
  });

  it('lists the discovery, discovers again on request', async () => {
    const list = (await api('GET', '/imports')).json as { node: string; lifecycle: string; composeProjects: number }[];

    expect(list).toEqual([
      expect.objectContaining({ node: 'host1', lifecycle: 'pending', composeProjects: 1, former: 'none' }),
    ]);

    const before = (await api('GET', '/imports/host1')).json;

    expect(before.items.map((i: { id: string }) => i.id)).toEqual(['compose:shop']);
    expect(before.projects).toEqual(['shop']);

    const requested = await api('POST', '/imports/host1/discover');

    expect(requested.status).toBe(202);
    await waitFor(async () => {
      const detail = (await api('GET', '/imports/host1')).json;

      return detail.discovery.id !== before.discovery.id ? detail : undefined;
    }).then((detail) => {
      expect(detail.discovery.source).toBe('refresh');
      expect(detail.discovery.report.warnings).toEqual(['refreshed']);
    });
    expect(agents.get('host1')?.discoveryRequests).toEqual([requested.json.request]);
  });

  it('refuses conflicting selections with reasons', async () => {
    const view = (
      await api('PUT', '/imports/host1/selection', {
        items: [{ item: 'compose:shop', choice: 'migrate', project: 'shop' }],
      })
    ).json;

    expect(view.joinPlan.errors).toEqual(
      expect.arrayContaining([
        'compose:shop: has data (read-write volumes or bind mounts); import it here, then move it with a normal plan (the replicated volume syncs to the target)',
        'compose:shop/web: port 80 is served by the HTTP ingress; give a hostname for it (the ingress routes by host name)',
      ]),
    );

    const plan = await api('POST', '/imports/host1/plan');

    expect(plan.status).toBe(400);
    expect(plan.json.errors.length).toBeGreaterThan(0);
  });

  it('builds one join plan and one plan: deployment + NodeImport, placed on the importing node', async () => {
    const view = (
      await api('PUT', '/imports/host1/selection', {
        items: [
          {
            item: 'compose:shop',
            choice: 'import',
            project: 'shop',
            http: { '80': 'shop.example.com' },
            variables: { ADMIN_PASSWORD: 'from-the-wizard' },
          },
        ],
      })
    ).json;

    expect(view.joinPlan.errors).toEqual([]);
    expect(view.joinPlan.steps.map((s: { id: string }) => s.id)).toEqual([
      'components',
      'activate',
      'shop/shop/precopy',
      'shop/shop/stop',
      'shop/shop/final-sync',
      'shop/shop/release',
      'shop/shop/verify',
      'handover',
    ]);
    expect(view.joinPlan.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'tunnel', subject: 'wg0', severity: 'resolved' }),
        expect.objectContaining({ kind: 'port', subject: 'udp/51820', severity: 'resolved' }),
      ]),
    );

    const plan = await api('POST', '/imports/host1/plan');

    expect(plan.status).toBe(201);

    const changes = plan.json.changes as {
      kind: string;
      name: string;
      action: string;
      after: { spec: Record<string, unknown> };
    }[];

    expect(changes.map((c) => `${c.action} ${c.kind}/${c.name}`).sort()).toEqual([
      'create Deployment/shop',
      'create NodeImport/host1',
    ]);

    const compose = parse(changes.find((c) => c.kind === 'Deployment')?.after.spec['compose'] as string);

    expect(compose.services.web['x-loadweaver']).toEqual({
      placement: { selector: { matchLabels: { 'loadweaver.com/node': 'host1' } } },
      exposure: { http: [{ host: 'shop.example.com', port: 80 }] },
    });
    expect(changes.find((c) => c.kind === 'NodeImport')?.after.spec['reservedPorts']).toEqual({
      tcp: [],
      udp: [51820],
    });
    expect(JSON.stringify(plan.json.workloadChanges)).toContain('host1');
    expect((await api('GET', '/imports/host1')).json.selection).toMatchObject({
      status: 'planned',
      planId: plan.json.id,
    });
  });

  it('applies the join plan: held until released, then components → activate → copies → stop → release → handover', async () => {
    const planId = (await api('GET', '/imports/host1')).json.selection.planId as string;

    await applyPlan(planId);

    const [node] = (await dataSource.query(`SELECT lifecycle, reserved_ports FROM lw_nodes WHERE name = 'host1'`)) as {
      lifecycle: string;
      reserved_ports: { udp: number[] };
    }[];

    expect(node.lifecycle).toBe('importing');
    expect(node.reserved_ports.udp).toEqual([51820]);
    expect(
      (await dataSource.query(`SELECT node FROM lw_workload_placements WHERE project = 'shop'`)) as { node: string }[],
    ).toEqual([{ node: 'host1' }]);
    expect(agents.get('host1')?.states).toEqual([]);

    const done = await driveUntil('host1', ['done', 'failed', 'rolled-back']);

    expect([done.status, done.error]).toEqual(['done', null]);

    const steps = agents.get('host1')?.steps ?? [];

    expect(steps.map((s) => `${s.step}:${s.action.kind}`)).toEqual([
      'components:components',
      'shop/shop/precopy:precopy',
      'shop/shop/stop:stop',
      'shop/shop/final-sync:final-sync',
      'handover:handover',
    ]);
    expect(steps[0].action).toMatchObject({ kind: 'components' });
    expect((steps[0].action as { script: string }).script).toContain('loadweaver-components: installed');
    expect(steps[1].action).toEqual({
      kind: 'precopy',
      copies: [{ source: '/var/lib/docker/volumes/shop_html/_data', volume: 'lw-vol-shop.shop.html' }],
    });
    expect(steps[2].action).toEqual({ kind: 'stop', containers: [NGINX] });
    expect(steps[4].action).toEqual({ kind: 'handover', containers: [NGINX], ports: [{ protocol: 'tcp', port: 80 }] });

    // Activated: a desired state with the volume; the workload only after the release step, with the hostname routed.
    const states = agents.get('host1')?.states ?? [];
    const firstWithVolume = states.findIndex((s) => s.volumes.some((v) => v.dockerName === 'lw-vol-shop.shop.html'));
    const firstWithWorkload = states.findIndex((s) => s.workloads.some((w) => w.id.startsWith('shop/shop/web/')));

    expect(firstWithVolume).toBeGreaterThanOrEqual(0);
    expect(firstWithWorkload).toBeGreaterThan(firstWithVolume);
    expect(states[0].lifecycle).toBe('active');
    expect(
      (await dataSource.query(`SELECT lifecycle FROM lw_nodes WHERE name = 'host1'`)) as { lifecycle: string }[],
    ).toEqual([{ lifecycle: 'active' }]);
    expect(
      agents
        .get('n1')
        ?.states.at(-1)
        ?.network.wireguard.map((l) => l.peer),
    ).toContain('host1');

    const detail = (await api('GET', '/imports/host1')).json.selection;

    expect(detail.released).toEqual(['shop/shop']);
    expect(detail.steps['shop/shop/precopy']).toMatchObject({ status: 'done', bytes: 4096 });
  });

  it('rolls back a failed final pass: the imported copy is held again and the source restarts', async () => {
    const report = discovery('host2', {
      composeProjects: [{ ...discovery('host2').composeProjects[0], name: 'blog' }],
      containers: [
        {
          ...discovery('host2').containers[0],
          compose: { project: 'blog', service: 'web', number: 1 },
          labels: { 'com.docker.compose.project': 'blog', 'com.docker.compose.service': 'web' },
        },
      ],
      volumes: [{ ...discovery('host2').volumes[0], name: 'blog_html', compose: { project: 'blog', volume: 'html' } }],
    });

    report.containers[0].mounts[0].name = 'blog_html';
    await join('host2', WG_KEYS[2], report);
    failing.add('shop/blog/final-sync');

    const view = (
      await api('PUT', '/imports/host2/selection', {
        items: [
          {
            item: 'compose:blog',
            choice: 'import',
            project: 'shop',
            http: { '80': 'blog.example.com' },
            variables: { ADMIN_PASSWORD: 'x' },
          },
        ],
      })
    ).json;

    expect(view.joinPlan.errors).toEqual([]);

    const plan = await api('POST', '/imports/host2/plan');

    expect(plan.status).toBe(201);
    await applyPlan(plan.json.id);

    const result = await driveUntil('host2', ['done', 'failed', 'rolled-back']);

    expect(result.status).toBe('rolled-back');
    expect(result.error).toBe('shop/blog/final-sync: rsync: connection unexpectedly closed');

    const steps = agents.get('host2')?.steps ?? [];

    expect(steps.at(-1)).toMatchObject({
      step: 'rollback',
      action: { kind: 'restart-source', containers: [NGINX], restartPolicies: { [NGINX]: 'unless-stopped' } },
    });
    // Never released: the imported copy doesn't run.
    expect(
      (agents.get('host2')?.states ?? []).some((s) => s.workloads.some((w) => w.id.startsWith('shop/blog/'))),
    ).toBe(false);
  });

  it('discards a pending import: the node leaves, nothing was changed on it', async () => {
    await join(
      'host3',
      'aAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=',
      discovery('host3', { composeProjects: [], containers: [], volumes: [] }),
    );

    const discarded = await api('DELETE', '/imports/host3');

    expect(discarded.json).toEqual({ discarded: false, nodeLeft: true });
    expect(
      (await dataSource.query(`SELECT lifecycle FROM lw_nodes WHERE name = 'host3'`)) as { lifecycle: string }[],
    ).toEqual([{ lifecycle: 'left' }]);
  });
});
