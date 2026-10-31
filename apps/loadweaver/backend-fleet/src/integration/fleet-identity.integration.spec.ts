/**
 * Fleet identity and parity against a real control plane (3.24 gate G6, needs Docker and the control-plane image
 * `ghcr.io/forepath/loadweaver-control-plane-api:latest`).
 *
 * Lab ({@link FleetLab}): one control plane "b" in **users** mode (a native admin, the fleet's service user with a
 * PAT carrying `fleet:on-behalf-of` + `plans:approve`, a native account sharing a fleet user's verified email), the
 * fleet in-process in users mode (one fleet admin + five fleet users with different grants), and a tiny HTTP stub
 * that plays a cluster without `GET /api/fleet-identity` (an older version).
 *
 * Covers: trust registration natively + "check now" → `verified` (untrusted / unsupported before), plans created
 * through the fleet by a person, the two-person rule across fleet persons and a native account with the same verified
 * email, claims refused by the cluster (forged, replayed, expired, changed body, removed key), key rotation, join
 * tokens for admin grants only (never in the fleet's audit / logs), project grants, the person-scoped live plans
 * stream, the streamed bundle upload with its declared digest, favourites / saved views per person and drafts with
 * `If-Match` / the topology preview. Automatic trust (2026-10-29): a revocation is never undone automatically, "Establish
 * trust" with the connection's credential (audited on both sides, idempotent), refused for a credential without
 * `cluster:admin`, a cluster admin's one-time token (never stored), and the automatic registration when a fleet admin
 * re-verifies the connection. API key fleet delegation (2026-10-29): a second control plane "c" in **api-key** mode,
 * connected with its static API key — verified probe, the fleet person as plan author, the two-person rule, the audit
 * (actor = the API key, `onBehalfOf` = the person), the role cap, replay / forged / unknown-issuer claims.
 */
import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';

import { FleetLab, waitFor, type LabControlPlane } from './fleet-lab';

// Users mode for the in-process fleet; set before `../bootstrap` (and the auth wiring) is imported.
Object.assign(process.env, {
  AUTHENTICATION_METHOD: 'users',
  JWT_SECRET: 'fleet-identity-it-jwt-secret-0123456789',
  // No mail server: password login without the forced e-mail second factor.
  DISABLE_FORCE_LOGIN_2FA: 'true',
  // The native trust flow first; automatic trust (2026-10-29) is switched on in its own block at the end.
  FLEET_AUTO_TRUST: 'false',
});

const PASSWORD = 'Sup3r-Secret-Passw0rd!';
const lab = new FleetLab('lw-fleet-id-it');

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary JSON response bodies
type Json = any;
interface Res {
  status: number;
  json: Json;
  text: string;
}

async function call(
  base: string,
  method: string,
  path: string,
  options: { token?: string | null; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Res> {
  const raw = Buffer.isBuffer(options.body) || typeof options.body === 'string';
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(options.body === undefined || raw ? {} : { 'content-type': 'application/json' }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {}),
    },
    body:
      options.body === undefined
        ? undefined
        : Buffer.isBuffer(options.body)
          ? new Uint8Array(options.body)
          : raw
            ? (options.body as string)
            : JSON.stringify(options.body),
  });
  const text = await res.text();
  let json: Json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { status: res.status, json, text };
}

const policy = (name: string, project: string) =>
  `apiVersion: loadweaver.com/v1\nkind: Policy\nmetadata: { name: ${name}, project: ${project} }\nspec:\n  from: [{ selector: { matchLabels: { role: ${name} } } }]\n  egressMode: enforce\n`;
const projectDoc = (name: string) =>
  `apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: ${name} }\nspec: {}\n`;

/** A minimal signed release bundle (manifest + signature + one artifact), like the control plane's updates spec. */
async function releaseBundle(version: string, privateKeyPem: string): Promise<Buffer> {
  const { buildManifest, buildTar, canonicalJson, MANIFEST_ENTRY, SIGNATURE_ENTRY, signManifest } = await import(
    '@forepath/loadweaver/shared/util-release'
  );
  const agent = Buffer.from(`loadweaver-agent ${version}\n`.repeat(64));
  const file = {
    path: 'artifacts/bin/loadweaver-agent-linux-amd64',
    sha256: createHash('sha256').update(agent).digest('hex'),
    size: agent.length,
  };
  const digest = `sha256:${createHash('sha256').update(`cp-${version}`).digest('hex')}`;
  const manifest = buildManifest({
    version,
    channel: 'stable',
    created: '2026-10-28T00:00:00.000Z',
    notes: [`release notes of ${version}`],
    images: { 'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api:${version}@${digest}` },
    agentBinaries: { amd64: file },
  });
  const bytes = Buffer.from(canonicalJson(manifest));

  return buildTar([
    { name: MANIFEST_ENTRY, data: bytes },
    { name: SIGNATURE_ENTRY, data: JSON.stringify(signManifest(bytes, privateKeyPem)) },
    { name: file.path, data: agent },
  ]);
}

describe('fleet identity claims and fleet parity against a users-mode control plane (3.24, G6)', () => {
  let app: INestApplication;
  let fleetUrl: string;
  let b: LabControlPlane;
  let stub: Server;
  let stubUrl: string;
  let releaseKey: { privateKeyPem: string; publicKeyPem: string };
  /** Everything the fleet process wrote to stdout / stderr (the join token must never appear). */
  const output: string[] = [];
  const restoreOutput: (() => void)[] = [];

  // Control plane b.
  let cpAdmin: string;
  let svcPat: string;
  let svcId: string;
  let svcToken: string;
  let fleetAdminId: string;
  let clusterId: string;
  // Fleet.
  let fleetAdmin: string;
  const users: Record<string, { id: string; token: string; email: string }> = {};
  let bId: string;
  let stubId: string;
  let issuer: string;
  let firstKid: string;
  let firstPublicKey: string;

  const cp = (method: string, path: string, body?: unknown, token: string | null = cpAdmin, headers = {}) =>
    call(`${b.url}/api`, method, path, { token, body, headers });
  const fleet = (method: string, path: string, token: string | null, body?: unknown, headers = {}) =>
    call(`${fleetUrl}/api`, method, path, { token, body, headers });
  const relay = (user: string, method: string, path: string, body?: unknown, headers = {}, cluster = bId) =>
    fleet(method, `/clusters/${cluster}/api/${path}`, users[user]?.token ?? user, body, headers);
  const sqlB = (statement: string) => lab.sql('cluster_b', statement);
  const sqlFleet = (statement: string) => lab.sql('fleet', statement);
  const person = (user: string) => `fleet:${issuer}:${users[user].id}`;
  const checkNow = async (cluster = bId) => (await fleet('POST', `/clusters/${cluster}/test`, fleetAdmin)).json;
  const trust = (keys: { kid: string; publicKey: string }[]) =>
    cp('PUT', `/trusted-fleets/${issuer}`, { name: 'fleet under test', keys });

  /** Registers + confirms (SQL, no mail server) + logs in a user of the fleet or the control plane. */
  async function account(
    base: string,
    database: string,
    email: string,
  ): Promise<{ id: string; token: string; email: string }> {
    const registered = await call(base, 'POST', '/auth/register', { body: { email, password: PASSWORD } });

    expect(registered.status).toBe(201);
    lab.sql(database, `UPDATE users SET email_confirmed_at = now() WHERE email = '${email}'`);

    const login = await call(base, 'POST', '/auth/login', { body: { email, password: PASSWORD } });

    expect(login.status).toBeLessThan(300);

    return { id: login.json.user.id, token: login.json.access_token, email };
  }

  /** The fleet's active signing key (the private key never leaves the fleet process; read for hand-made claims). */
  async function fleetSigningKey(): Promise<{ kid: string; issuer: string; key: KeyObject }> {
    const { FleetIdentityService } = await import('./fleet-lib');
    const service = app.get(FleetIdentityService) as unknown as {
      signingKey(): Promise<{ kid: string; issuer: string; key: KeyObject }>;
    };

    return await service.signingKey();
  }

  /** A hand-made claim for a direct request to b with the service user's PAT. */
  async function claim(
    request: { method: string; url: string; body?: Buffer | null },
    options: { key?: KeyObject; kid?: string; now?: Date } = {},
  ): Promise<string> {
    const { mintFleetClaim } = await import('./fleet-lib');
    const signing = await fleetSigningKey();

    return mintFleetClaim(
      options.key ?? signing.key,
      options.kid ?? signing.kid,
      {
        issuer: signing.issuer,
        audience: clusterId,
        subject: users['alice'].id,
        email: users['alice'].email,
        emailVerified: true,
        role: 'admin',
        method: request.method,
        url: request.url,
        body: request.body ?? null,
      },
      options.now,
    );
  }

  beforeAll(async () => {
    // Fleet output (Nest logger) is collected to prove that a join token is never logged.
    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream);

      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        output.push(String(chunk));

        return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write;
      restoreOutput.push(() => (stream.write = write));
    }

    const { generateReleaseKeyPair } = await import('@forepath/loadweaver/shared/util-release');

    releaseKey = generateReleaseKeyPair();

    await lab.start(['fleet', 'cluster_b', 'cluster_c']);
    b = await lab.startControlPlane('b', 'cluster_b', {
      AUTHENTICATION_METHOD: 'users',
      DISABLE_FORCE_LOGIN_2FA: 'true',
      // Bundles signed by the test's release key are trusted (development key; NODE_ENV=development).
      LOADWEAVER_RELEASE_DEV_KEYS: releaseKey.publicKeyPem,
    });

    // A cluster without fleet identities (an older version): `GET /api/cluster` works, `fleet-identity` is 404.
    stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');

      if (req.method === 'GET' && req.url === '/api/cluster') {
        res.setHeader('x-loadweaver-version', '0.9.0');
        res.end(
          JSON.stringify({ clusterId: '00000000-0000-4000-8000-000000000001', nodes: { total: 0, connected: 0 } }),
        );

        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ statusCode: 404, message: `Cannot ${req.method} ${req.url}` }));
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

    lab.useForFleet('fleet');

    const { createApp } = await import('../bootstrap');

    app = await createApp();
    await app.listen(0, '127.0.0.1');
    fleetUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    // ---- control plane b: native admin, projects, the fleet's service user + PAT, a native "alice".
    cpAdmin = (await account(`${b.url}/api`, 'cluster_b', 'admin@b.example.test')).token;
    clusterId = (await cp('GET', '/cluster')).json.clusterId;
    expect(clusterId).toBeTruthy();

    for (const project of ['shop', 'other']) {
      const plan = await cp('POST', '/plans', { documents: projectDoc(project) });

      expect(plan.status).toBe(201);
      expect((await cp('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');
      // Every change needs a second person's approval.
      expect((await cp('PUT', `/projects/${project}/settings`, { approvalMode: 'everyone' })).status).toBe(200);
    }

    const svc = await account(`${b.url}/api`, 'cluster_b', 'fleet-service@b.example.test');

    expect((await cp('PUT', `/cluster/members/${svc.id}`, { role: 'cluster-admin' })).status).toBe(204);
    svcId = svc.id;
    svcToken = svc.token;

    const pat = await cp(
      'POST',
      '/auth/tokens',
      {
        name: 'fleet',
        scopes: [
          'cluster:read',
          'projects:read',
          'resources:read',
          'alerts:read',
          'alerts:write',
          'metrics:read',
          'logs:read',
          'audit:read',
          'usage:read',
          'fleet:on-behalf-of',
          'plans:create',
          'plans:apply',
          'plans:approve',
          'cluster:nodes',
          'live:access',
          'cluster:admin',
          'projects:admin',
          'backups:export',
          'backups:import',
        ],
      },
      svc.token,
    );

    expect(pat.status).toBe(201);
    svcPat = pat.json.token;

    // ---- fleet: the admin (first account) and the users with their grants (set in the first test).
    const admin = await account(`${fleetUrl}/api`, 'fleet', 'admin@fleet.example.test');

    fleetAdmin = admin.token;
    fleetAdminId = admin.id;

    for (const name of ['alice', 'bob', 'carol', 'dave', 'erin'])
      users[name] = await account(`${fleetUrl}/api`, 'fleet', `${name}@example.test`);
  }, 600_000);

  afterAll(async () => {
    restoreOutput.forEach((restore) => restore());
    await app?.close();
    await new Promise((resolve) => (stub ? stub.close(resolve) : resolve(undefined)));
    lab.teardown();
  });

  it('registers b (untrusted) and an older cluster (unsupported), with grants per fleet user', async () => {
    const created = await fleet('POST', '/clusters', fleetAdmin, {
      name: 'b',
      endpoint: `${b.url}/api`,
      credential: svcPat,
    });

    expect(created.status).toBe(201);
    expect(created.json.identity).toMatchObject({ status: 'untrusted' });
    bId = created.json.id;

    const old = await fleet('POST', '/clusters', fleetAdmin, { name: 'old', endpoint: stubUrl, credential: svcPat });

    expect(old.status).toBe(201);
    expect(old.json.identity).toMatchObject({ status: 'unsupported' });
    stubId = old.json.id;

    // alice / bob: cluster-wide admins; carol: cluster-wide operator; dave: admin of shop only; erin: operator of
    // shop only.
    for (const [name, role, project] of [
      ['alice', 'admin', undefined],
      ['bob', 'admin', undefined],
      ['carol', 'operator', undefined],
      ['dave', 'admin', 'shop'],
      ['erin', 'operator', 'shop'],
    ] as const)
      for (const cluster of [bId, stubId])
        expect(
          (
            await fleet('PUT', `/clusters/${cluster}/grants`, fleetAdmin, {
              userId: users[name].id,
              role,
              ...(project ? { project } : {}),
            })
          ).status,
        ).toBe(200);
  });

  it('keeps approvals and personal routes away from clusters that do not verify the fleet', async () => {
    const someId = '11111111-2222-4333-8444-555555555555';
    // Untrusting cluster: 403 with the hint to register the fleet.
    const approve = await relay('bob', 'POST', `plans/${someId}/approve`, {});

    expect(approve.status).toBe(403);
    expect(approve.json.message).toMatch(/trust this fleet/);
    expect((await relay('alice', 'GET', 'search/favorites')).status).toBe(403);
    expect((await relay('alice', 'GET', 'views')).status).toBe(403);
    // Project grants on person-scoped routes need a verifying cluster too.
    expect((await relay('erin', 'GET', 'drafts')).status).toBe(403);

    // A cluster without the endpoint: approvals and favourites stay native (404).
    expect((await relay('bob', 'POST', `plans/${someId}/approve`, {}, {}, stubId)).status).toBe(404);
    expect((await relay('alice', 'GET', 'search/favorites', undefined, {}, stubId)).status).toBe(404);
  });

  it('is trusted natively (never through the fleet), then "check now" reports verified', async () => {
    const identity = await fleet('GET', '/identity', fleetAdmin);

    expect(identity.status).toBe(200);
    issuer = identity.json.issuer;
    expect(identity.json.keys).toEqual([expect.objectContaining({ state: 'active' })]);
    firstKid = identity.json.keys[0].kid;
    firstPublicKey = identity.json.keys[0].publicKey;
    // Fleet users that aren't fleet admins don't see the identity.
    expect((await fleet('GET', '/identity', users['alice'].token)).status).toBe(403);

    // The relay never forwards trusted fleets; the service user's PAT alone (no proof claim) is refused.
    expect((await relay('alice', 'GET', 'trusted-fleets')).status).toBe(404);
    expect(
      (
        await cp(
          'PUT',
          `/trusted-fleets/${issuer}`,
          { name: 'self-registered', keys: [{ kid: firstKid, publicKey: firstPublicKey }] },
          svcPat,
        )
      ).status,
    ).toBe(403);

    const trusted = await trust([{ kid: firstKid, publicKey: firstPublicKey }]);

    expect(trusted.status).toBe(200);

    const health = await checkNow();

    expect(health).toMatchObject({ identity: 'verified' });

    const detail = await fleet('GET', `/clusters/${bId}`, users['alice'].token);

    expect(detail.json.identity).toEqual({ status: 'verified', reason: null, person: person('alice') });
  });

  describe('approvals through the fleet', () => {
    let planId: string;

    it('stores the fleet person as the plan author', async () => {
      const plan = await relay('alice', 'POST', 'plans', { documents: policy('fleet-one', 'shop') });

      expect(plan.status).toBe(201);
      expect(plan.json.status).toBe('pending');
      planId = plan.json.id;

      const native = await cp('GET', `/plans/${planId}`);

      expect(native.json.createdBy).toBe(person('alice'));
    });

    it("refuses the author's own approval (the cluster's 403 is passed through)", async () => {
      const own = await relay('alice', 'POST', `plans/${planId}/approve`, {});

      expect(own.status).toBe(403);
      expect(own.json.message).toMatch(/not the plan author/);
    });

    it('refuses a native account with the author’s verified email', async () => {
      const native = await account(`${b.url}/api`, 'cluster_b', users['alice'].email);

      expect((await cp('PUT', `/projects/shop/members/${native.id}`, { role: 'operator' })).status).toBe(204);

      const refused = await cp('POST', `/plans/${planId}/approve`, {}, native.token);

      expect(refused.status).toBe(403);
    });

    it('records a second person’s approval via the fleet, audited with the person, and applies', async () => {
      const approved = await relay('bob', 'POST', `plans/${planId}/approve`, {});

      expect(approved.status).toBeLessThan(300);
      expect(sqlB(`SELECT user_id || '|' || via FROM lw_plan_approvals WHERE plan_id = '${planId}'`)).toBe(
        `${person('bob')}|fleet`,
      );

      const audit = JSON.parse(
        sqlB(
          `SELECT json_agg(json_build_object('actor', actor_id, 'details', details)) FROM lw_audit_events WHERE action = 'plan.approve' AND target = 'plan/${planId}'`,
        ),
      );

      expect(audit).toEqual([
        expect.objectContaining({
          details: expect.objectContaining({ onBehalfOf: person('bob'), onBehalfOfEmail: users['bob'].email }),
        }),
      ]);

      const applied = await relay('alice', 'POST', `plans/${planId}/apply`, {});

      expect(applied.status).toBeLessThan(300);
      expect(applied.json.status).toBe('applied');
    });
  });

  describe('claims the cluster refuses (sent directly with the service user’s PAT)', () => {
    const view = (name: string) => Buffer.from(JSON.stringify({ scope: 'resources', name, state: { q: name } }));
    const direct = (body: Buffer, token: string) =>
      call(`${b.url}/api`, 'POST', '/views', {
        token: svcPat,
        body,
        headers: { 'content-type': 'application/json', 'x-loadweaver-fleet-identity': token },
      });

    it('accepts a valid claim once and refuses its replay', async () => {
      const body = view('direct');
      const token = await claim({ method: 'POST', url: '/api/views', body });
      const first = await direct(body, token);

      expect(first.status).toBe(201);
      expect(sqlB(`SELECT owner FROM lw_saved_views WHERE id = '${first.json.id}'`)).toBe(person('alice'));

      const replay = await direct(body, token);

      expect(replay.status).toBe(403);
      expect(replay.json.message).toMatch(/^fleet identity claim refused: .*replay/);
    });

    it('refuses a forged signature, an expired claim and a changed body', async () => {
      const body = view('refused');
      const other = generateKeyPairSync('ed25519').privateKey;
      const forged = await direct(body, await claim({ method: 'POST', url: '/api/views', body }, { key: other }));

      expect(forged.status).toBe(403);
      expect(forged.json.message).toMatch(/^fleet identity claim refused/);

      const expired = await direct(
        body,
        await claim({ method: 'POST', url: '/api/views', body }, { now: new Date(Date.now() - 5 * 60_000) }),
      );

      expect(expired.status).toBe(403);
      expect(expired.json.message).toMatch(/^fleet identity claim refused/);

      const changed = await direct(view('changed'), await claim({ method: 'POST', url: '/api/views', body }));

      expect(changed.status).toBe(403);
      expect(changed.json.message).toMatch(/^fleet identity claim refused/);
      expect(sqlB(`SELECT count(*) FROM lw_saved_views WHERE name IN ('refused', 'changed')`)).toBe('0');
    });
  });

  describe('fleet parity', () => {
    it('relays join tokens for cluster-wide admins only, never storing or logging the token', async () => {
      const created = await relay('alice', 'POST', 'join-tokens', { ttlMinutes: 10 });

      expect(created.status).toBe(201);

      const token: string = created.json.token;

      expect(token).toBeTruthy();

      const listed = await relay('alice', 'GET', 'join-tokens');

      expect(listed.status).toBe(200);
      expect(listed.json.map((t: { id: string }) => t.id)).toContain(created.json.id);
      expect((await relay('alice', 'DELETE', `join-tokens/${created.json.id}`)).status).toBeLessThan(300);

      // Operator and project-admin grants: refused before anything is forwarded.
      expect((await relay('carol', 'POST', 'join-tokens', { ttlMinutes: 10 })).status).toBe(403);
      expect((await relay('dave', 'POST', 'join-tokens', { ttlMinutes: 10 })).status).toBe(403);
      expect((await relay('dave', 'GET', 'join-tokens')).status).toBe(403);

      // Native only, also for admins.
      expect((await relay('alice', 'POST', 'nodes/join', {})).status).toBe(404);
      expect((await relay('alice', 'GET', 'install/install.sh')).status).toBe(404);
      expect((await relay('alice', 'POST', 'backups/keys/1/kit', {})).status).toBe(404);
      expect((await relay('alice', 'GET', 'trusted-fleets')).status).toBe(404);

      // The cluster audits the service user with the acting fleet person.
      const audit = sqlB(
        `SELECT actor_id || '|' || (details->>'onBehalfOf') FROM lw_audit_events WHERE action LIKE 'join-token%' ORDER BY seq LIMIT 1`,
      );

      expect(audit).toMatch(new RegExp(`\\|${person('alice')}$`));

      // The fleet: the change is audited without the token, which appears neither there nor in its output.
      const fleetAudit = await fleet('GET', '/audit', fleetAdmin);

      expect(fleetAudit.status).toBe(200);
      expect(JSON.stringify(fleetAudit.json)).toContain(`api/join-tokens`);
      expect(JSON.stringify(fleetAudit.json)).not.toContain(token);
      expect(sqlFleet(`SELECT count(*) FROM lw_fleet_audit_events WHERE details::text LIKE '%${token}%'`)).toBe('0');
      expect(output.join('')).not.toContain(token);
    });

    it('lets a project-only grant reach its project and nothing else', async () => {
      const otherPlan = await cp('POST', '/plans', { documents: policy('native-other', 'other') });

      expect(otherPlan.status).toBe(201);

      const own = await relay('erin', 'POST', 'plans', { documents: policy('erin-shop', 'shop') });

      expect(own.status).toBe(201);
      expect(own.json.createdBy).toBe(person('erin'));
      expect((await relay('erin', 'GET', `plans/${own.json.id}`)).status).toBe(200);
      expect((await relay('erin', 'GET', 'plans?project=shop')).status).toBe(200);

      // Other projects and cluster-wide routes: refused at the fleet or invisible at the cluster.
      expect((await relay('erin', 'GET', 'plans?project=other')).status).toBe(403);
      expect((await relay('erin', 'GET', 'overview')).status).toBe(403);
      expect((await relay('erin', 'GET', `plans/${otherPlan.json.id}`)).status).toBe(404);

      const foreign = await relay('erin', 'POST', 'plans', { documents: policy('erin-other', 'other') });

      expect(foreign.status).toBe(403);
      expect(sqlB(`SELECT count(*) FROM lw_plans WHERE changes::text LIKE '%erin-other%'`)).toBe('0');
    });

    it('streams live plans per grant: a project grant sees only its project', async () => {
      const connect = (token: string): Promise<Socket> =>
        new Promise((resolve, reject) => {
          const socket = io(`${fleetUrl}/socket/fleet`, {
            transports: ['websocket'],
            auth: { Authorization: `Bearer ${token}` },
            reconnection: false,
          });

          socket.once('connect', () => resolve(socket));
          socket.once('connect_error', reject);
        });
      const snapshot = async (user: string): Promise<{ plans: { id: string; changes: unknown }[] }> => {
        const socket = await connect(users[user].token);

        try {
          return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`no plans snapshot for ${user}`)), 30_000);

            socket.on('relayError', (error: { message: string }) => {
              clearTimeout(timer);
              reject(new Error(error.message));
            });
            socket.on('event', (e: { event: string; args: [{ plans: { id: string; changes: unknown }[] }] }) => {
              if (e.event !== 'plansSnapshot') return;

              clearTimeout(timer);
              resolve(e.args[0]);
            });
            socket.emit('attach', { clusterId: bId, namespace: 'plans' });
          });
        } finally {
          socket.disconnect();
        }
      };
      const projects = (s: { plans: { changes: unknown }[] }) =>
        [...new Set(s.plans.flatMap((p) => (p.changes as { project: string | null }[]).map((c) => c.project)))].sort();

      // Pending plans exist in shop (erin's) and other (the native admin's).
      expect(projects(await snapshot('alice'))).toEqual(['other', 'shop']);
      expect(projects(await snapshot('erin'))).toEqual(['shop']);

      // Streams that aren't person-scoped need a cluster-wide grant.
      const socket = await connect(users['erin'].token);

      try {
        const refused = await new Promise<{ message: string }>((resolve) => {
          socket.once('relayError', resolve);
          socket.emit('attach', { clusterId: bId, namespace: 'logs' });
        });

        expect(refused.message).toMatch(/cluster-wide/);
      } finally {
        socket.disconnect();
      }
    });

    it('streams a bundle upload with a declared digest: right digest imported, wrong refused, admins only', async () => {
      const upload = (user: string, bundle: Buffer, digest: string) =>
        relay(user, 'POST', 'updates/bundles', bundle, {
          'content-type': 'application/x-tar',
          'x-loadweaver-content-sha256': digest,
        });
      const good = await releaseBundle('1.1.0', releaseKey.privateKeyPem);
      const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

      expect((await upload('carol', good, sha(good))).status).toBe(403);

      const wrong = await releaseBundle('1.2.0', releaseKey.privateKeyPem);
      const refused = await upload('alice', wrong, sha(good));

      expect(refused.status).toBe(400);
      expect(refused.json.message).toMatch(/SHA-256|digest/i);
      expect(sqlB(`SELECT count(*) FROM lw_releases WHERE version = '1.2.0' AND status = 'available'`)).toBe('0');

      const imported = await upload('alice', good, sha(good));

      expect(imported.status).toBe(201);
      expect(imported.json).toMatchObject({ version: '1.1.0', status: 'available', signed: true });
      expect(
        sqlB(
          `SELECT details->>'onBehalfOf' FROM lw_audit_events WHERE action = 'update.bundle-imported' AND target = 'release/1.1.0'`,
        ),
      ).toBe(person('alice'));
    });

    it('keeps favourites and saved views per fleet person', async () => {
      const item = encodeURIComponent('Project:shop');

      expect((await relay('alice', 'PUT', `search/favorites/${item}`)).status).toBe(204);
      expect((await relay('alice', 'GET', 'search/favorites')).json).toEqual(['Project:shop']);
      expect((await relay('bob', 'GET', 'search/favorites')).json).toEqual([]);

      const created = await relay('bob', 'POST', 'views', { scope: 'plans', name: 'bob-view', state: { a: 1 } });

      expect(created.status).toBe(201);

      const names = async (user: string) =>
        ((await relay(user, 'GET', 'views?scope=plans')).json as { name: string }[]).map((v) => v.name);

      expect(await names('bob')).toEqual(['bob-view']);
      expect(await names('alice')).toEqual([]);
      expect(sqlB(`SELECT owner FROM lw_saved_views WHERE name = 'bob-view'`)).toBe(person('bob'));
    });

    it('edits drafts with If-Match (409 on a stale version) and previews the topology', async () => {
      const draft = await relay('alice', 'POST', 'drafts', {
        title: 'fleet draft',
        ops: [{ op: 'upsert', document: policy('draft-one', 'shop') }],
      });

      expect(draft.status).toBe(201);

      const version = draft.json.version as number;
      const patched = await relay(
        'alice',
        'PATCH',
        `drafts/${draft.json.id}`,
        { title: 'fleet draft (edited)' },
        { 'if-match': `"${version}"` },
      );

      expect(patched.status).toBe(200);
      expect(patched.json.version).toBe(version + 1);

      const stale = await relay(
        'alice',
        'PATCH',
        `drafts/${draft.json.id}`,
        { title: 'stale edit' },
        { 'if-match': `"${version}"` },
      );

      expect(stale.status).toBe(409);

      const preview = await relay('alice', 'POST', 'topology/preview', { documents: policy('preview-one', 'shop') });

      expect(preview.status).toBe(200);
      expect(preview.json.plan).toMatchObject({ changes: [expect.objectContaining({ name: 'preview-one' })] });
      expect(sqlB(`SELECT count(*) FROM lw_plans WHERE changes::text LIKE '%preview-one%'`)).toBe('0');
    });
  });

  it('rotates the fleet key: claims keep verifying, the old key is removed from the cluster afterwards', async () => {
    const old = await fleetSigningKey();
    const next = await fleet('POST', '/identity/keys', fleetAdmin);

    expect(next.status).toBe(201);

    const nextKey = (next.json.keys as { kid: string; state: string; publicKey: string }[]).find(
      (k) => k.state === 'next',
    ) as { kid: string; publicKey: string };

    expect(nextKey).toBeDefined();
    expect(
      (
        await trust([
          { kid: firstKid, publicKey: firstPublicKey },
          { kid: nextKey.kid, publicKey: nextKey.publicKey },
        ])
      ).status,
    ).toBe(200);

    const activated = await fleet('POST', `/identity/keys/${nextKey.kid}/activate`, fleetAdmin);

    expect(activated.status).toBe(200);
    expect(activated.json.keys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kid: firstKid, state: 'retired' }),
        expect.objectContaining({ kid: nextKey.kid, state: 'active' }),
      ]),
    );

    // The old key leaves the cluster; the fleet signs with the new one (the trusted-fleet cache is dropped on change).
    expect((await trust([{ kid: nextKey.kid, publicKey: nextKey.publicKey }])).status).toBe(200);
    expect(await checkNow()).toMatchObject({ identity: 'verified' });

    const after = await relay('alice', 'POST', 'views', { scope: 'plans', name: 'after-rotation', state: {} });

    expect(after.status).toBe(201);
    expect(sqlB(`SELECT owner FROM lw_saved_views WHERE name = 'after-rotation'`)).toBe(person('alice'));

    // A claim signed with the removed key is refused.
    const body = Buffer.from(JSON.stringify({ scope: 'plans', name: 'old-key', state: {} }));
    const refused = await call(`${b.url}/api`, 'POST', '/views', {
      token: svcPat,
      body,
      headers: {
        'content-type': 'application/json',
        'x-loadweaver-fleet-identity': await claim(
          { method: 'POST', url: '/api/views', body },
          { key: old.key, kid: old.kid },
        ),
      },
    });

    expect(refused.status).toBe(403);
    expect(refused.json.message).toMatch(/not registered/);
  });

  it('answers 403 for approvals again once the cluster stops trusting the fleet', async () => {
    expect((await cp('DELETE', `/trusted-fleets/${issuer}`)).status).toBe(204);
    await waitFor('untrusted', async () => (await checkNow())?.identity === 'untrusted', 60_000);
    expect((await relay('bob', 'POST', 'plans/11111111-2222-4333-8444-555555555555/approve', {})).status).toBe(403);
  });

  describe('automatic trust (2026-10-29)', () => {
    const trustRows = () => sqlB(`SELECT count(*) FROM lw_audit_events WHERE action LIKE 'fleet.trust.%'`);

    beforeAll(() => {
      process.env['FLEET_AUTO_TRUST'] = 'true';
    });

    afterAll(() => {
      process.env['FLEET_AUTO_TRUST'] = 'false';
    });

    it('never re-registers by itself after a cluster admin removed the fleet', async () => {
      // The previous test removed the trust natively: the poll marks it revoked and leaves it.
      const health = await checkNow();

      expect(health).toMatchObject({ identity: 'untrusted', trust: expect.objectContaining({ state: 'revoked' }) });
      expect(await checkNow()).toMatchObject({ identity: 'untrusted' });
      expect(sqlB(`SELECT count(*) FROM lw_trusted_fleets WHERE issuer = '${issuer}'`)).toBe('0');
    });

    it('"Establish trust" with the connection’s credential: registered by the fleet, audited on both sides', async () => {
      // Fleet users that aren't fleet admins can't.
      expect((await fleet('POST', `/clusters/${bId}/trust`, users['alice'].token, {})).status).toBe(403);

      const result = await fleet('POST', `/clusters/${bId}/trust`, fleetAdmin, {});

      expect(result.status).toBe(200);
      expect(result.json.attempt).toMatchObject({ state: 'established', via: 'service-credential', by: fleetAdminId });
      expect(result.json.cluster.health).toMatchObject({ identity: 'verified', identitySince: expect.any(String) });
      // Exactly the fleet's active key, created by the service user, visible to the cluster's admins (revocable).
      const listed = await cp('GET', '/trusted-fleets');

      expect(listed.json).toEqual([
        expect.objectContaining({
          issuer,
          createdBy: svcId,
          keys: [expect.objectContaining({ kid: (await fleetSigningKey()).kid })],
        }),
      ]);
      expect(
        sqlB(
          `SELECT details->>'registeredBy' || '|' || coalesce(details->>'onBehalfOf', '') FROM lw_audit_events WHERE action = 'fleet.trust.create' ORDER BY seq DESC LIMIT 1`,
        ),
      ).toBe(`fleet|fleet:${issuer}:${fleetAdminId}`);
      expect(
        sqlFleet(
          `SELECT actor_id FROM lw_fleet_audit_events WHERE action = 'identity.trust-established' ORDER BY seq DESC LIMIT 1`,
        ),
      ).toBe(fleetAdminId);
      // Approvals work through the fleet again.
      expect(await checkNow()).toMatchObject({ identity: 'verified' });
    });

    it('is idempotent: a second call changes nothing', async () => {
      const before = trustRows();
      const again = await fleet('POST', `/clusters/${bId}/trust`, fleetAdmin, {});

      expect(again.json.attempt).toMatchObject({ state: 'already-trusted' });
      expect(trustRows()).toBe(before);
    });

    it('refuses a credential without cluster:admin; a cluster admin’s one-time token works and is never stored', async () => {
      expect((await cp('DELETE', `/trusted-fleets/${issuer}`)).status).toBe(204);

      const limited = await cp(
        'POST',
        '/auth/tokens',
        {
          name: 'fleet-limited',
          scopes: ['cluster:read', 'projects:read', 'resources:read', 'fleet:on-behalf-of', 'plans:approve'],
        },
        svcToken,
      );

      expect(limited.status).toBe(201);
      expect((await fleet('PATCH', `/clusters/${bId}`, fleetAdmin, { credential: limited.json.token })).status).toBe(
        200,
      );

      const refused = await fleet('POST', `/clusters/${bId}/trust`, fleetAdmin, {});

      expect(refused.json.attempt).toMatchObject({ state: 'forbidden' });
      expect(sqlB(`SELECT count(*) FROM lw_trusted_fleets WHERE issuer = '${issuer}'`)).toBe('0');

      const once = await fleet('POST', `/clusters/${bId}/trust`, fleetAdmin, { adminToken: cpAdmin });

      expect(once.json.attempt).toMatchObject({ state: 'established', via: 'one-time-token' });
      expect(sqlFleet(`SELECT count(*) FROM lw_fleet_clusters WHERE health::text LIKE '%${cpAdmin.slice(-24)}%'`)).toBe(
        '0',
      );
      expect(
        sqlFleet(`SELECT count(*) FROM lw_fleet_audit_events WHERE details::text LIKE '%${cpAdmin.slice(-24)}%'`),
      ).toBe('0');
      expect(output.join('')).not.toContain(cpAdmin);
    });

    it('registers automatically when a fleet admin re-verifies the connection with an authorised credential', async () => {
      expect((await cp('DELETE', `/trusted-fleets/${issuer}`)).status).toBe(204);
      await waitFor('untrusted', async () => (await checkNow())?.identity === 'untrusted', 60_000);

      const updated = await fleet('PATCH', `/clusters/${bId}`, fleetAdmin, { credential: svcPat });

      expect(updated.status).toBe(200);
      expect(await checkNow()).toMatchObject({
        identity: 'verified',
        trust: expect.objectContaining({ state: 'established' }),
      });
      expect(sqlB(`SELECT created_by FROM lw_trusted_fleets WHERE issuer = '${issuer}'`)).toBe(svcId);
    });
  });

  describe('API key fleet delegation (2026-10-29, user decision)', () => {
    const API_KEY = 'fleet-identity-it-static-api-key-0123456789';
    let c: LabControlPlane;
    let cId: string;
    let cClusterId: string;
    let planId: string;

    const cpC = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      call(`${c.url}/api`, method, path, { token: API_KEY, body, headers });
    const sqlC = (statement: string) => lab.sql('cluster_c', statement);
    /** A hand-made claim for a direct request to c with its API key. */
    const claimC = async (
      request: { method: string; url: string; body?: Buffer | null },
      options: { role?: 'admin' | 'operator' | 'viewer' | null; user?: string; key?: KeyObject; issuer?: string } = {},
    ) => {
      const { mintFleetClaim } = await import('./fleet-lib');
      const signing = await fleetSigningKey();
      const user = users[options.user ?? 'alice'];

      return mintFleetClaim(options.key ?? signing.key, signing.kid, {
        issuer: options.issuer ?? signing.issuer,
        audience: cClusterId,
        subject: user.id,
        email: user.email,
        emailVerified: true,
        role: options.role === undefined ? 'admin' : options.role,
        method: request.method,
        url: request.url,
        body: request.body ?? null,
      });
    };

    beforeAll(async () => {
      c = await lab.startControlPlane('c', 'cluster_c', { AUTHENTICATION_METHOD: 'api-key', STATIC_API_KEY: API_KEY });
      cClusterId = (await cpC('GET', '/cluster')).json.clusterId;
      expect(cClusterId).toBeTruthy();

      const plan = await cpC('POST', '/plans', { documents: projectDoc('shop') });

      expect(plan.status).toBe(201);
      expect((await cpC('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');
      expect((await cpC('PUT', '/projects/shop/settings', { approvalMode: 'everyone' })).status).toBe(200);

      // Trusted natively with the API key (the fleet's active key); the fleet connects with the same API key.
      const identity = await fleet('GET', '/identity', fleetAdmin);
      const active = identity.json.keys.find((k: { state: string }) => k.state === 'active');

      expect(
        (
          await cpC('PUT', `/trusted-fleets/${issuer}`, {
            name: 'fleet',
            keys: [{ kid: active.kid, publicKey: active.publicKey }],
          })
        ).status,
      ).toBe(200);

      const created = await fleet('POST', '/clusters', fleetAdmin, {
        name: 'c',
        endpoint: `${c.url}/api`,
        credential: API_KEY,
      });

      expect(created.status).toBe(201);
      cId = created.json.id;

      for (const name of ['alice', 'bob'])
        expect(
          (await fleet('PUT', `/clusters/${cId}/grants`, fleetAdmin, { userId: users[name].id, role: 'admin' })).status,
        ).toBe(200);
    }, 300_000);

    it('the identity probe over the API key reports verified (no "Not in effect")', async () => {
      expect(await checkNow(cId)).toMatchObject({ identity: 'verified', identityReason: null });

      const detail = await fleet('GET', `/clusters/${cId}`, users['alice'].token);

      expect(detail.json.identity).toEqual({ status: 'verified', reason: null, person: person('alice') });
    });

    it('stores the fleet person as the plan author; the author can’t approve, a second person can', async () => {
      const plan = await relay('alice', 'POST', 'plans', { documents: policy('fleet-key', 'shop') }, {}, cId);

      expect(plan.status).toBe(201);
      planId = plan.json.id;
      expect((await cpC('GET', `/plans/${planId}`)).json.createdBy).toBe(person('alice'));

      const own = await relay('alice', 'POST', `plans/${planId}/approve`, {}, {}, cId);

      expect(own.status).toBe(403);
      expect(own.json.message).toMatch(/not the plan author/);

      const approved = await relay('bob', 'POST', `plans/${planId}/approve`, {}, {}, cId);

      expect(approved.status).toBeLessThan(300);
      expect(sqlC(`SELECT user_id || '|' || via FROM lw_plan_approvals WHERE plan_id = '${planId}'`)).toBe(
        `${person('bob')}|fleet`,
      );
      // The actor stays the API key; the person is recorded.
      expect(
        sqlC(
          `SELECT actor_type || '|' || coalesce(actor_id, '') || '|' || (details->>'onBehalfOf') || '|' || (details->>'onBehalfOfEmail') FROM lw_audit_events WHERE action = 'plan.approve' AND target = 'plan/${planId}'`,
        ),
      ).toBe(`api-key||${person('bob')}|${users['bob'].email}`);
    });

    it('caps the person at the claim: a viewer claim on the API key can’t create plans', async () => {
      const body = Buffer.from(JSON.stringify({ documents: policy('viewer-try', 'shop') }));
      const viewer = await cpC('POST', '/plans', body, {
        'content-type': 'application/json',
        'x-loadweaver-fleet-identity': await claimC({ method: 'POST', url: '/api/plans', body }, { role: 'viewer' }),
      });

      expect(viewer.status).toBe(403);
    });

    it('refuses a replayed or forged claim; ignores an unknown issuer (the API key acts natively)', async () => {
      const view = (name: string) => Buffer.from(JSON.stringify({ scope: 'resources', name, state: { q: name } }));
      const send = (body: Buffer, token: string) =>
        cpC('POST', '/views', body, { 'content-type': 'application/json', 'x-loadweaver-fleet-identity': token });
      const body = view('key-direct');
      const token = await claimC({ method: 'POST', url: '/api/views', body });

      expect((await send(body, token)).status).toBe(201);
      expect((await send(body, token)).status).toBe(403);

      const forged = await send(
        body,
        await claimC({ method: 'POST', url: '/api/views', body }, { key: generateKeyPairSync('ed25519').privateKey }),
      );

      expect(forged.status).toBe(403);
      expect(forged.json.message).toMatch(/^fleet identity claim refused/);

      const stranger = view('key-stranger');
      const unknown = await send(
        stranger,
        await claimC({ method: 'POST', url: '/api/views', body: stranger }, { issuer: 'stranger-fleet' }),
      );

      expect(unknown.status).toBe(201);
      expect(sqlC(`SELECT owner FROM lw_saved_views WHERE id = '${unknown.json.id}'`)).toBe('api-key');
    });
  });
});
