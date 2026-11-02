import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join as joinPath } from 'node:path';
import { gzipSync } from 'node:zlib';

import { ArtifactStore, RolloutControllerService } from '@forepath/loadweaver/backend/feature-control-plane';
import {
  agentMessage,
  decodeControlPlaneMessage,
  openAgentStream,
  PROTOCOL_VERSION,
  type ComponentVersions,
  type DesiredState,
  type Envelope,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { checkJsonSchema, type JsonSchemaObject } from '@forepath/loadweaver/shared/util-json-schema';
import { createCsr, generateKeyPair, generateWireguardKeyPair } from '@forepath/loadweaver/shared/util-pki';
import {
  buildManifest,
  buildTar,
  canonicalJson,
  generateReleaseKeyPair,
  imageComponents,
  imageReference,
  MANIFEST_ENTRY,
  SIGNATURE_ENTRY,
  signManifest,
  verifyManifest,
  type ArtifactFile,
} from '@forepath/loadweaver/shared/util-release';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../bootstrap';

/**
 * Update rollout (3.26, M6 step 2) against simulated agents: three control-plane members (m1 the Patroni leader),
 * two regular nodes speaking protocol v2 with `components`, and an agent built before versioning (`old`). The
 * simulated agents verify the signed manifest the way the real agent does, "self-update" by reconnecting with the
 * release's agent version, switch Patroni over on request, and fail on demand.
 */

const API_KEY = 'integration-test-api-key';
const RELEASE_KEY = generateReleaseKeyPair();
const UNTRUSTED_KEY = generateReleaseKeyPair();
const NODES_WG = ['m1', 'm2', 'm3', 'w1', 'w2', 'old'].map(() => generateWireguardKeyPair().publicKey);
const NODES = ['m1', 'm2', 'm3', 'w1', 'w2', 'old'] as const;
const CP_DIGEST = (v: string) => `sha256:${createHash('sha256').update(`cp-${v}`).digest('hex')}`;

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

function bundle(version: string, key = RELEASE_KEY.privateKeyPem, sign = true): Buffer {
  const agent = Buffer.from(`loadweaver-agent ${version}\n`.repeat(64));
  const file: ArtifactFile = {
    path: 'artifacts/bin/loadweaver-agent-linux-amd64',
    sha256: createHash('sha256').update(agent).digest('hex'),
    size: agent.length,
  };
  const manifest = buildManifest({
    version,
    channel: 'stable',
    created: '2026-10-19T00:00:00.000Z',
    notes: [`release notes of ${version}`],
    images: { 'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api:${version}@${CP_DIGEST(version)}` },
    agentBinaries: { amd64: file },
  });
  const bytes = Buffer.from(canonicalJson(manifest));

  return buildTar([
    { name: MANIFEST_ENTRY, data: bytes },
    ...(sign ? [{ name: SIGNATURE_ENTRY, data: JSON.stringify(signManifest(bytes, key)) }] : []),
    { name: file.path, data: agent },
  ]);
}

interface SimAgent {
  node: string;
  states: DesiredState[];
  violations: string[];
  components: ComponentVersions;
  agentVersion: string;
  close(): void;
}

describe('update rollout (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let dataSource: DataSource;
  const agents = new Map<string, SimAgent>();
  const credentials = new Map<string, Parameters<typeof openAgentStream>[1]>();
  /** Nodes whose update to these releases fails (the simulated agent reports a failed action). */
  const failOn = new Map<string, string>();
  /**
   * Nodes whose apply of these releases fails in the control-plane layer although the release label is reported (the
   * old in-memory label: the rollout's apply gate must not trust it).
   */
  const failControlPlaneOn = new Map<string, string>();
  /** Every release target in arrival order: `node:release`. */
  const targets: string[] = [];

  const api = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary JSON response bodies
  ): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${API_KEY}`,
        ...(Buffer.isBuffer(body) ? { 'content-type': 'application/x-tar' } : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body),
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

  const hello = (agent: Pick<SimAgent, 'node' | 'agentVersion' | 'components'>, legacy: boolean) => ({
    nodeName: agent.node,
    agentVersion: agent.agentVersion,
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
    wireguardPublicKey: NODES_WG[NODES.indexOf(agent.node as (typeof NODES)[number])],
    endpointHost: `${agent.node}.example.test`,
    appliedRevision: 0,
    ...(legacy ? {} : { protocolVersion: PROTOCOL_VERSION, features: ['components'], components: agent.components }),
  });

  /** Opens (or re-opens, after a "self-update") the node's stream. */
  let stopped = false;
  const open = (agent: SimAgent, legacy: boolean): void => {
    if (stopped) return;

    const { client, stream } = openAgentStream(
      process.env.LOADWEAVER_GRPC_ENDPOINTS as string,
      credentials.get(agent.node) as never,
    );
    let applied = 0;
    const heartbeat = () =>
      stream.write(
        agentMessage('heartbeat', {
          appliedRevision: applied,
          usage: { cpuMillis: 100, memoryBytes: 1_000_000, diskBytes: 1_000_000 },
          at: new Date().toISOString(),
          ...(legacy ? {} : { components: agent.components }),
        }),
      );
    const timer = setInterval(heartbeat, 1_000);
    let closed = false;

    agent.close = () => {
      if (closed) return;

      closed = true;
      clearInterval(timer);
      stream.end();
      client.close();
    };
    stream.on('error', () => undefined);
    stream.on('data', (env: Envelope) => {
      if (legacy) {
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

      if (decoded.message.type !== 'desiredState') return;

      const state = decoded.message.payload as DesiredState;

      agent.states.push(state);
      applied = state.revision;

      const target = state.components;
      const report = (failed = false) =>
        stream.write(
          agentMessage(
            'applyReport',
            failed
              ? {
                  revision: state.revision,
                  status: 'failed',
                  steps: [{ layer: 'control-plane', status: 'failed', message: 'etcd did not start' }],
                }
              : { revision: state.revision, status: 'applied', steps: [] },
          ),
        );

      if (!target || closed) return report();

      // Like the real agent: only a manifest signed with a trusted key counts.
      const verified = verifyManifest(
        Buffer.from(target.manifest),
        target.signature ? JSON.parse(target.signature) : null,
        {
          trustedKeys: [RELEASE_KEY.publicKeyPem],
          allowUnsigned: false,
        },
      );
      const release = verified.manifest.version;
      const switchover = target.actions?.patroniSwitchover;

      report(failControlPlaneOn.get(agent.node) === release);

      if (switchover && agent.components.postgres === 'leader') {
        // The leader hands over to the candidate before its own member updates.
        const candidate = [...agents.values()].find((a) => overlay(a.node) === switchover.candidate);

        agent.components = { ...agent.components, postgres: 'replica' };

        if (candidate) candidate.components = { ...candidate.components, postgres: 'leader' };
      }

      if (agent.components.release === release) return heartbeat();

      targets.push(`${agent.node}:${release}`);

      if (failOn.get(agent.node) === release) {
        agent.components = {
          ...agent.components,
          actions: [
            {
              id: `self-update:${release}`,
              kind: 'self-update',
              phase: 'failed',
              error: 'checksum mismatch',
              at: new Date().toISOString(),
            },
          ],
        };
        heartbeat();

        return;
      }

      // "Self-update": swap the binary, restart (reconnect) with the release's agent version.
      const agentVersion = (verified.manifest.components['node-agent'] as { version: string }).version;

      agent.components = {
        ...agent.components,
        release,
        images: {
          ...agent.components.images,
          // Members run etcd, Postgres and the API with the release's digests (the rollout's images gate).
          ...(agent.node.startsWith('m')
            ? {
                ...Object.fromEntries(
                  ['etcd', 'postgres']
                    .filter((c) => imageComponents(verified.manifest)[c])
                    .map((c) => [c, imageReference(imageComponents(verified.manifest)[c])]),
                ),
                'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api@${CP_DIGEST(release)}`,
              }
            : {}),
        },
        actions: [],
      };
      agent.agentVersion = agentVersion;
      setTimeout(() => {
        agent.close();
        open(agent, false);
      }, 50);
    });
    stream.write(agentMessage('hello', hello(agent, legacy)));
  };

  const overlays = new Map<string, string>();
  const overlay = (node: string) => overlays.get(node) ?? '';

  const controller = () => app.get(RolloutControllerService);

  /** Drives the controller until `done` holds. */
  const drive = async (done: () => Promise<boolean>, rounds = 150): Promise<void> => {
    for (let i = 0; i < rounds; i++) {
      if (await done()) return;

      await controller().tick();
      await sleep(250);
    }

    throw new Error(
      `rollout did not reach the expected state: ${JSON.stringify((await api('GET', '/updates/rollouts?limit=1')).json?.[0]?.steps?.map((s: { node: string; state: string }) => `${s.node}:${s.state}`))}`,
    );
  };

  const rollout = async (id: string) => (await api('GET', `/updates/rollouts/${id}`)).json;

  beforeAll(async () => {
    process.env.VERSION = '3.4.0';
    process.env.LOADWEAVER_RELEASE_DEV_KEYS = RELEASE_KEY.publicKeyPem;
    process.env.LOADWEAVER_UPDATE_SETTLE_SECONDS = '0';
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    dataSource = app.get(DataSource);

    for (const [i, node] of NODES.entries()) {
      const token = (await api('POST', '/join-tokens', {})).json.token as string;
      const keys = await generateKeyPair();
      const legacy = node === 'old';
      const agent: SimAgent = {
        node,
        states: [],
        violations: [],
        agentVersion: '3.4.0',
        components: {
          release: '3.4.0',
          images: {},
          bootId: `boot-${node}`,
          ...(node.startsWith('m') ? { postgres: node === 'm1' ? ('leader' as const) : ('replica' as const) } : {}),
        },
        close: () => undefined,
      };
      const res = await api('POST', '/nodes/join', {
        token,
        nodeName: node,
        csrPem: await createCsr(keys, node),
        hello: hello(agent, legacy),
      });

      expect(res.status).toBe(200);
      credentials.set(node, {
        caCertificatePem: res.json.caCertificatePem,
        certificatePem: res.json.certificatePem,
        privateKeyPem: keys.privateKeyPem,
      });
      agents.set(node, agent);
      open(agent, legacy);
      void i;
    }

    await waitFor(async () => {
      const rows: { name: string; overlay_v4: string; control_plane: boolean }[] = await dataSource.query(
        `SELECT name, overlay_v4, control_plane FROM lw_nodes WHERE connected ORDER BY name`,
      );

      rows.forEach((r) => overlays.set(r.name, r.overlay_v4));

      return rows.length === NODES.length && rows.filter((r) => r.control_plane).length === 3 ? true : undefined;
    });
  });

  afterAll(async () => {
    stopped = true;
    agents.forEach((a) => a.close());
    await app?.close();
  });

  it('refuses bundles with a bad signature or none, before anything is stored', async () => {
    const forged = await api('POST', '/updates/bundles', bundle('3.6.0', UNTRUSTED_KEY.privateKeyPem));

    expect(forged.status).toBe(400);
    expect(forged.json.message).toMatch(/does not verify with any trusted release key/);

    const unsigned = await api('POST', '/updates/bundles', bundle('3.6.0', undefined, false));

    expect(unsigned.status).toBe(400);
    expect(unsigned.json.message).toMatch(/not signed/);
    expect(await dataSource.query(`SELECT version FROM lw_releases WHERE version = '3.6.0'`)).toEqual([]);
    expect(
      (await dataSource.query(`SELECT action, details FROM lw_audit_events WHERE action = 'update.bundle-refused'`))
        .length,
    ).toBe(2);
  });

  it('imports signed bundles (air-gap upload) and lists them', async () => {
    for (const version of ['3.4.0', '3.5.0', '3.5.1']) {
      const res = await api('POST', '/updates/bundles', bundle(version));

      expect(res.status).toBe(201);
      expect(res.json).toMatchObject({ version, status: 'available', signed: true, keyId: RELEASE_KEY.keyId });
    }

    expect((await api('POST', '/updates/bundles', bundle('3.5.0'))).status).toBe(409);

    const releases = (await api('GET', '/updates/releases')).json as { version: string; status: string }[];

    expect(releases.map((r) => `${r.version}:${r.status}`)).toEqual([
      '3.5.1:available',
      '3.5.0:available',
      '3.4.0:available',
    ]);

    // The agent binary is served by checksum, publicly (nodes fetch only from the cluster).
    const agent = Buffer.from('loadweaver-agent 3.5.0\n'.repeat(64));
    const res = await fetch(`${baseUrl}/api/updates/artifacts/${createHash('sha256').update(agent).digest('hex')}`);

    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(agent)).toBe(true);
  });

  it('plans an update: members first (leader last), canary, waves; the pre-versioning agent is left out', async () => {
    const plan = await api('POST', '/updates/rollouts', { version: '3.5.0' });

    expect(plan.status).toBe(201);
    expect(plan.json).toMatchObject({ status: 'planned', fromVersion: '3.4.0', toVersion: '3.5.0', kind: 'minor' });
    expect(plan.json.steps.map((s: { phase: string; node: string }) => `${s.phase}:${s.node}`)).toEqual([
      'control-plane:m2',
      'control-plane:m3',
      'control-plane:m1',
      'canary:w1',
      'wave:w2',
    ]);
    expect(plan.json.warnings).toEqual([expect.stringContaining('the agent on old predates release components')]);
    expect(plan.json.notes).toEqual(['release notes of 3.5.0']);
    expect(plan.json.diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node: 'w1', component: 'node-agent', from: '3.4.0', to: '3.5.0' }),
        expect.objectContaining({
          node: 'm1',
          component: 'control-plane',
          to: expect.stringContaining(CP_DIGEST('3.5.0')),
        }),
      ]),
    );
    // Nothing moves before the approval.
    await controller().tick();
    expect(targets).toEqual([]);
  });

  it('rolls out member by member with a Patroni switchover, then canary and waves; contract migrations follow', async () => {
    const id = (await api('GET', '/updates/rollouts?limit=1')).json[0].id as string;

    expect((await api('POST', `/updates/rollouts/${id}/approve`, {})).json.status).toBe('approved');
    await drive(async () => (await rollout(id)).status === 'completed');

    expect(targets).toEqual(['m2:3.5.0', 'm3:3.5.0', 'm1:3.5.0', 'w1:3.5.0', 'w2:3.5.0']);
    // m1 (the leader) switched over to an updated replica before its own update.
    expect(agents.get('m1')?.components.postgres).toBe('replica');
    expect([...agents.values()].filter((a) => a.components.postgres === 'leader').map((a) => a.node)).toHaveLength(1);
    expect(
      agents
        .get('m1')
        ?.states.some((s) => s.components?.actions?.patroniSwitchover && s.components.release === '3.5.0'),
    ).toBe(true);

    const nodes: { name: string; agent_version: string; release: string }[] = await dataSource.query(
      `SELECT name, agent_version, component_versions->>'release' AS release FROM lw_nodes ORDER BY name`,
    );

    expect(
      nodes.filter((n) => n.name !== 'old').every((n) => n.agent_version === '3.5.0' && n.release === '3.5.0'),
    ).toBe(true);

    const status = (await api('GET', '/updates/status')).json;

    expect(status.clusterVersion).toBe('3.5.0');
    // The pre-versioning node still runs 3.4.0: contract migrations wait for it.
    expect(status.contractMigrations).toMatchObject({ ready: false, blockers: [expect.stringContaining('old')] });
    expect(
      (
        await dataSource.query(`SELECT action FROM lw_audit_events WHERE target = $1 ORDER BY seq`, [`rollout/${id}`])
      ).map((r: { action: string }) => r.action),
    ).toEqual(['update.planned', 'update.approve', 'update.completed']);
  });

  it('never sends release components to the N-1 agent', () => {
    const old = agents.get('old') as SimAgent;

    expect(old.states.length).toBeGreaterThan(0);
    expect(old.states.some((s) => 'components' in s)).toBe(false);
    expect(old.violations).toEqual([]);
  });

  it('pauses on a failing gate, rolls the step back, then rolls the whole update back in reverse', async () => {
    failOn.set('w1', '3.5.1');

    const plan = (await api('POST', '/updates/rollouts', { version: '3.5.1' })).json;

    expect(plan.kind).toBe('patch');
    await api('POST', `/updates/rollouts/${plan.id}/approve`, {});
    targets.length = 0;
    await drive(async () => {
      const r = await rollout(plan.id);

      return r.status === 'paused' && r.steps.find((s: { node: string }) => s.node === 'w1').state === 'rolled-back';
    });

    const paused = await rollout(plan.id);

    expect(paused.pauseReason).toMatch(/step 3 on w1: .*self-update on w1 failed: checksum mismatch/);
    // m2 became the Patroni leader in the previous update, so it goes last among the members now.
    expect(paused.steps.map((s: { node: string; state: string }) => `${s.node}:${s.state}`)).toEqual([
      'm1:done',
      'm3:done',
      'm2:done',
      'w1:rolled-back',
      'w2:pending',
    ]);
    // The canary got 3.5.1 and was put back on 3.5.0; w2 never moved.
    expect(agents.get('w1')?.states.at(-1)?.components?.release).toBe('3.5.0');
    expect(targets).not.toContain('w2:3.5.1');

    // The operator rolls the update back: updated nodes return to 3.5.0, the control-plane members last.
    targets.length = 0;
    failOn.delete('w1');
    expect((await api('POST', `/updates/rollouts/${plan.id}/rollback`)).json.status).toBe('rolling-back');
    await drive(async () => (await rollout(plan.id)).status === 'rolled-back');
    expect(targets).toEqual(['m2:3.5.0', 'm3:3.5.0', 'm1:3.5.0']);
    expect((await api('GET', '/updates/status')).json.clusterVersion).toBe('3.5.0');
  });

  it('survives a leader change mid-step: the next replica resumes from the stored state', async () => {
    const plan = (await api('POST', '/updates/rollouts', { version: '3.5.1' })).json;

    await api('POST', `/updates/rollouts/${plan.id}/approve`, {});
    targets.length = 0;
    // The current leader starts the first step, then "dies" while the step verifies.
    await drive(async () => (await rollout(plan.id)).steps[0].state !== 'pending');

    const before = (await rollout(plan.id)).steps[0];

    await dataSource.query(
      `UPDATE lw_rollouts SET lease_owner = 'another-replica', lease_until = now() + interval '1 hour' WHERE id = $1`,
      [plan.id],
    );
    await controller().tick();
    await controller().tick();
    expect((await rollout(plan.id)).steps[0].state).toBe(before.state);

    // Its lease expires; this replica takes over and finishes without re-sending what was already sent.
    await dataSource.query(`UPDATE lw_rollouts SET lease_until = now() - interval '1 second' WHERE id = $1`, [plan.id]);
    await drive(async () => (await rollout(plan.id)).status === 'completed');
    expect(targets.filter((t) => t === 'm2:3.5.1')).toHaveLength(1);
    expect(targets).toEqual(['m2:3.5.1', 'm3:3.5.1', 'm1:3.5.1', 'w1:3.5.1', 'w2:3.5.1']);
    expect(
      (await dataSource.query(`SELECT lease_owner FROM lw_rollouts WHERE id = $1`, [plan.id]))[0].lease_owner,
    ).toBeNull();
  });

  /** The Postgres leader among the members, as the simulated agents report it. */
  const leader = () => [...agents.values()].find((a) => a.components.postgres === 'leader')?.node as string;

  it('fails a member step whose control-plane layer failed although the release label matches (apply gate)', async () => {
    expect((await api('POST', '/updates/bundles', bundle('3.5.2'))).status).toBe(201);

    const plan = (await api('POST', '/updates/rollouts', { version: '3.5.2' })).json;
    const first = plan.steps[0].node as string;

    failControlPlaneOn.set(first, '3.5.2');
    await api('POST', `/updates/rollouts/${plan.id}/approve`, {});
    targets.length = 0;
    await drive(async () => {
      const r = await rollout(plan.id);

      return r.status === 'paused' && r.steps[0].state === 'rolled-back';
    });

    const paused = await rollout(plan.id);

    expect(paused.pauseReason).toMatch(
      new RegExp(`${first} failed to apply revision \\d+ \\(layer control-plane: etcd did not start\\)`),
    );
    // The member reported 3.5.2 as its release, yet it was put back on 3.5.1 and nobody else moved.
    expect(targets).toEqual([`${first}:3.5.2`, `${first}:3.5.1`]);
    expect(paused.steps.slice(1).every((s: { state: string }) => s.state === 'pending')).toBe(true);
    failControlPlaneOn.delete(first);
    // Nothing in flight any more: the paused rollout can be cancelled.
    expect((await api('POST', `/updates/rollouts/${plan.id}/cancel`)).json.status).toBe('cancelled');
  });

  it('waits while etcd is unhealthy on a member (quorum gate); cancel with a step in flight is refused (409)', async () => {
    const members = ['m1', 'm2', 'm3'].map((n) => agents.get(n) as SimAgent);

    for (const m of members) m.components = { ...m.components, etcd: { healthy: true, members: 3 } };

    const plan = (await api('POST', '/updates/rollouts', { version: '3.5.2' })).json;
    const sick = members.find((m) => m.node !== plan.steps[0].node) as SimAgent;

    sick.components = { ...sick.components, etcd: { healthy: false, members: 3 } };
    await sleep(1_500);
    await api('POST', `/updates/rollouts/${plan.id}/approve`, {});

    const waiting = async () => {
      const step = (await rollout(plan.id)).steps[0];

      return step.state === 'verifying' &&
        step.gates.some(
          (g: { name: string; ok: boolean; message: string }) =>
            g.name === 'quorum' && !g.ok && g.message.includes(`etcd on ${sick.node}`),
        )
        ? true
        : false;
    };

    await drive(waiting);
    // It keeps waiting, the next member doesn't start.
    for (let i = 0; i < 4; i++) await controller().tick();
    expect(await waiting()).toBe(true);
    expect((await rollout(plan.id)).steps[1].state).toBe('pending');

    // Paused with the member step verifying: cancelling would strand it.
    expect((await api('POST', `/updates/rollouts/${plan.id}/pause`)).status).toBeLessThan(300);

    const cancel = await api('POST', `/updates/rollouts/${plan.id}/cancel`);

    expect(cancel.status).toBe(409);
    expect(cancel.json.message).toContain(`${plan.steps[0].node} (verifying)`);
    expect((await rollout(plan.id)).status).toBe('paused');

    // etcd recovers: the rollout resumes and completes.
    sick.components = { ...sick.components, etcd: { healthy: true, members: 3 } };
    expect((await api('POST', `/updates/rollouts/${plan.id}/resume`)).status).toBeLessThan(300);
    await drive(async () => (await rollout(plan.id)).status === 'completed');
  });

  it('reorders when the leader moved after planning: a replica goes first, the leader switches over (no in-place leader step)', async () => {
    expect((await api('POST', '/updates/bundles', bundle('3.5.3'))).status).toBe(201);

    const plan = (await api('POST', '/updates/rollouts', { version: '3.5.3' })).json;
    const members = plan.steps
      .filter((s: { phase: string }) => s.phase === 'control-plane')
      .map((s: { node: string }) => s.node) as string[];

    // Planned with the leader last; then leadership moves to the first planned member.
    expect(members.at(-1)).toBe(leader());

    const [moved, second] = members;

    for (const a of agents.values())
      if (a.components.postgres) a.components = { ...a.components, postgres: a.node === moved ? 'leader' : 'replica' };

    await sleep(1_500);
    targets.length = 0;
    await api('POST', `/updates/rollouts/${plan.id}/approve`, {});
    await drive(async () => (await rollout(plan.id)).status === 'completed');

    // The not-yet-started replica ran first; the new leader handed over to it before its own update.
    expect(targets.slice(0, 3)).toEqual([`${second}:3.5.3`, `${moved}:3.5.3`, `${members[2]}:3.5.3`]);
    expect(
      agents
        .get(moved)
        ?.states.some(
          (s) => s.components?.release === '3.5.3' && s.components.actions?.patroniSwitchover !== undefined,
        ),
    ).toBe(true);
    expect(agents.get(moved)?.components.postgres).toBe('replica');
    expect(
      (await rollout(plan.id)).steps
        .filter((s: { phase: string }) => s.phase === 'control-plane')
        .sort((a: { wave: number }, b: { wave: number }) => a.wave - b.wave)
        .map((s: { node: string }) => s.node),
    ).toEqual([second, moved, members[2]]);
  });

  it('reports the unsigned-bundle opt-in in the status', async () => {
    const status = (await api('GET', '/updates/status')).json;

    expect(status.unsignedBundles).toMatchObject({ allowed: false });
    expect(status.clusterVersion).toBe('3.5.3');
  });

  it('serves the frozen apt snapshot (package names percent-encoded by apt) publicly', async () => {
    const store = app.get(ArtifactStore);
    const inRelease = Buffer.from('frozen InRelease');
    const deb = Buffer.from('openssl package');
    const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
    // Pool files are served only when a frozen Packages index names them with their checksum (M6 review M3).
    const packagesGz = gzipSync(
      [
        'Package: openssl',
        'Filename: pool/main/o/openssl/openssl_3.5.7-1~deb13u3_amd64.deb',
        `Size: ${deb.length}`,
        `SHA256: ${sha(deb)}`,
        '',
      ].join('\n'),
    );

    await store.putBuffer(inRelease);
    await store.putBuffer(deb);
    await store.putBuffer(packagesGz);
    await dataSource.query(`INSERT INTO lw_apt_snapshots (id, sources, files, origin) VALUES ($1, $2, $3, 'plan')`, [
      's-it-1',
      JSON.stringify([
        {
          name: 'debian-trixie',
          url: 'https://deb.example',
          suites: ['trixie'],
          components: ['main'],
          arches: ['amd64'],
          keyring: '/usr/share/keyrings/debian-archive-keyring.gpg',
          os: 'debian:13',
        },
      ]),
      JSON.stringify({
        'debian-trixie/dists/trixie/InRelease': {
          sha256: createHash('sha256').update(inRelease).digest('hex'),
          size: inRelease.length,
        },
        'debian-trixie/dists/trixie/main/binary-amd64/Packages.gz': {
          sha256: sha(packagesGz),
          size: packagesGz.length,
        },
      }),
    ]);
    await dataSource.query(`INSERT INTO lw_apt_files (source_url, path, sha256, size) VALUES ($1, $2, $3, $4)`, [
      'https://deb.example',
      'pool/main/o/openssl/openssl_3.5.7-1~deb13u3_amd64.deb',
      createHash('sha256').update(deb).digest('hex'),
      deb.length,
    ]);

    const base = `${baseUrl}/api/updates/apt/s-it-1/debian-trixie`;
    const index = await fetch(`${base}/dists/trixie/InRelease`);

    expect(index.status).toBe(200);
    expect(Buffer.from(await index.arrayBuffer()).equals(inRelease)).toBe(true);

    const pkg = await fetch(`${base}/pool/main/o/openssl/openssl_3.5.7-1%7edeb13u3_amd64.deb`);

    expect(pkg.status).toBe(200);
    expect(Buffer.from(await pkg.arrayBuffer()).equals(deb)).toBe(true);
    expect((await fetch(`${base}/dists/trixie/main/binary-amd64/Packages.xz`)).status).toBe(404);
    // A pool path no frozen index names is not fetched from upstream (no open download proxy).
    expect((await fetch(`${base}/pool/main/e/evil/evil_1.0_amd64.deb`)).status).toBe(404);
    expect((await fetch(`${base}/../../etc/passwd`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/updates/apt/s-unknown/debian-trixie/dists/trixie/InRelease`)).status).toBe(404);
  });

  it('serves only cluster admins the update actions', async () => {
    expect((await fetch(`${baseUrl}/api/updates/status`)).status).toBe(401);
    expect((await api('POST', '/updates/rollouts', { version: '9.9.9' })).status).toBe(409);
    expect((await api('POST', '/updates/rollouts', { version: '3.5.1', bogus: true })).status).toBe(400);
  });
});
