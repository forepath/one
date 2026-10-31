import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

// eslint-disable-next-line @nx/enforce-module-boundaries -- drive the hourly retention pass without adding a public library export just for this integration test
import { DraftRetentionService } from '../../../../../libs/domains/loadweaver/backend/feature-control-plane/src/lib/drafts/draft-retention.service';

/**
 * Workspace drafts, saved views, registry tokens by project roles, the claim → cluster-admin membership and email
 * login 2FA without SMTP (M7 gate G6), against the control plane in users mode with real accounts: concurrent draft
 * edits / submits, dry-run previews that store nothing, the draft expiry pass, per-owner saved views with their
 * limits and audit, and registry tokens per project role through personal access tokens.
 */

// Users mode; set before the app module is loaded (it reads the method at import time). No SMTP and no
// DISABLE_FORCE_LOGIN_2FA: forced email login 2FA is suspended because no code could be delivered (2026-10-24 fix).
Object.assign(process.env, {
  AUTHENTICATION_METHOD: 'users',
  JWT_SECRET: 'workspace-access-integration-jwt-secret-0123456789',
});
delete process.env['DISABLE_FORCE_LOGIN_2FA'];
delete process.env['SMTP_HOST'];
delete process.env['SMTP_PORT'];

const PASSWORD = 'Sup3r-Secret-Passw0rd!';
const DAY_MS = 86_400_000;

const policy = (name: string, project = 'shop', role = 'ci') =>
  `apiVersion: loadweaver.com/v1\nkind: Policy\nmetadata: { name: ${name}, project: ${project} }\nspec:\n  from: [{ selector: { matchLabels: { role: ${role} } } }]\n  egressMode: enforce\n`;

interface Account {
  id: string;
  email: string;
  session: string;
}

describe('Workspace drafts, saved views and access (integration, users mode)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: DataSource;
  let admin: Account;
  let devA: Account;
  let devB: Account;
  let viewer: Account;
  let outsider: Account;

  const api = async (
    method: string,
    path: string,
    body?: unknown,
    token: string | null = admin.session,
    headers: Record<string, string> = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test helper returns arbitrary JSON response bodies
  ): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();

    return { status: res.status, json: text ? JSON.parse(text) : null };
  };

  const waitFor = async <T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> => {
    const start = Date.now();

    for (;;) {
      const value = await fn();

      if (value !== undefined) return value;

      if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${fn.toString().slice(0, 200)}`);

      await new Promise((r) => setTimeout(r, 200));
    }
  };

  const login = async (email: string): Promise<string> => {
    const res = await api('POST', '/auth/login', { email, password: PASSWORD }, null);

    expect(res.status).toBe(200);

    return res.json.access_token as string;
  };

  /** Registers a further account (not the first: unconfirmed), confirms its email in the database, logs in. */
  const account = async (email: string): Promise<Account> => {
    const registered = await api('POST', '/auth/register', { email, password: PASSWORD }, null);

    expect(registered.status).toBe(201);
    expect(registered.json.user.role).toBe('user');
    await db.query(`UPDATE users SET email_confirmed_at = now() WHERE id = $1`, [registered.json.user.id]);

    return { id: registered.json.user.id, email, session: await login(email) };
  };

  const applyPlan = async (documents: string) => {
    const plan = await api('POST', '/plans', { documents });

    expect(plan.status).toBe(201);
    expect((await api('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');
  };

  const audit = async (
    action: string,
  ): Promise<{ target: string; actor_id: string | null; details: Record<string, unknown> }[]> =>
    await db.query(`SELECT target, actor_id, details FROM lw_audit_events WHERE action = $1 ORDER BY seq`, [action]);

  beforeAll(async () => {
    const { createApp } = await import('../bootstrap');

    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    db = app.get(DataSource);

    // The first account claims the cluster (global admin; confirmed without email).
    const first = await api('POST', '/auth/register', { email: 'ops@example.test', password: PASSWORD }, null);

    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ emailConfirmed: true, user: { role: 'admin' } });
    admin = { id: first.json.user.id, email: 'ops@example.test', session: await login('ops@example.test') };

    devA = await account('dev-a@example.test');
    devB = await account('dev-b@example.test');
    viewer = await account('viewer@example.test');
    outsider = await account('outsider@example.test');

    await applyPlan(`apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: shop }\nspec: {}\n`);
    await applyPlan(`apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: other }\nspec: {}\n`);

    for (const [user, role] of [
      [devA, 'developer'],
      [devB, 'developer'],
      [viewer, 'viewer'],
    ] as const)
      expect((await api('PUT', `/projects/shop/members/${user.id}`, { role })).status).toBe(204);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('claim → cluster admin', () => {
    it('makes the first account a cluster-admin member (audited via admin-claim), nobody after it', async () => {
      const [membership] = await waitFor(async () => {
        const rows = await db.query(`SELECT user_id, role, created_by FROM lw_cluster_members WHERE user_id = $1`, [
          admin.id,
        ]);

        return rows.length ? rows : undefined;
      });

      expect(membership).toMatchObject({ role: 'cluster-admin', created_by: 'admin-claim' });

      const claims = (await audit('cluster.member.set')).filter((e) => e.details.via === 'admin-claim');

      expect(claims).toEqual([
        {
          target: `cluster/member/${admin.id}`,
          actor_id: admin.id,
          details: expect.objectContaining({ role: 'cluster-admin', previous: null, via: 'admin-claim' }),
        },
      ]);

      // A second administrator (created by the first) and the registered users get no cluster membership.
      const second = await api('POST', '/users', { email: 'admin2@example.test', password: PASSWORD, role: 'admin' });

      expect(second.status).toBe(201);
      // The grant is fire and forget: give a (wrong) grant the time to land before checking it didn't.
      await new Promise((r) => setTimeout(r, 1_000));
      expect(await db.query(`SELECT user_id FROM lw_cluster_members`)).toEqual([{ user_id: admin.id }]);
      expect((await audit('cluster.member.set')).length).toBe(1);
      expect((await api('GET', '/access/me', undefined, devA.session)).json).toMatchObject({
        clusterRole: null,
        projects: { shop: 'developer' },
      });
    });
  });

  describe('email login 2FA without SMTP', () => {
    it('logs in with the password only and reports the suspension to cluster admins', async () => {
      const res = await api('POST', '/auth/login', { email: admin.email, password: PASSWORD }, null);

      expect(res.status).toBe(200);
      expect(res.json.access_token).toEqual(expect.any(String));
      expect(JSON.stringify(res.json)).not.toContain('LOGIN_2FA_REQUIRED');

      expect((await api('GET', '/access/me')).json).toMatchObject({
        clusterRole: 'cluster-admin',
        emailLogin2faSuspended: true,
      });
      // Not a cluster admin: no banner.
      expect((await api('GET', '/access/me', undefined, devA.session)).json.emailLogin2faSuspended).toBe(false);
      // The effective status: nothing forced; enabling email 2FA is refused (no code could arrive).
      expect((await api('GET', '/auth/2fa', undefined, devA.session)).json).toMatchObject({ forceEnabled: false });
      const enable = await api('POST', '/auth/2fa/email/enable', {}, devA.session);

      expect(enable.status).toBe(400);
      expect(enable.json.message).toContain('Email is not configured');
    });
  });

  describe('registry tokens by project roles', () => {
    const SCOPE =
      'service=loadweaver-registry&scope=repository:shop/app:pull,push&scope=repository:other/app:pull,push';

    const pat = async (user: Account, scopes: string[]): Promise<string> => {
      const res = await api('POST', '/auth/tokens', { name: `registry-${scopes.length}`, scopes }, user.session);

      expect(res.status).toBe(201);

      return res.json.token as string;
    };

    const access = async (token: string, query = SCOPE) => {
      const res = await fetch(`${baseUrl}/api/registry/token?${query}`, {
        headers: { authorization: `Basic ${Buffer.from(`docker:${token}`).toString('base64')}` },
      });

      if (res.status !== 200) return { status: res.status, access: null };

      const { token: jwt } = (await res.json()) as { token: string };
      const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

      return { status: 200, access: claims.access as { name: string; actions: string[] }[], sub: claims.sub };
    };

    it('grants pull / push per project role, nothing on other projects, everything to the cluster admin', async () => {
      const both = ['registry:pull', 'registry:push'];

      // Developer: pull + push on the own project, nothing elsewhere.
      expect(await access(await pat(devA, both))).toEqual({
        status: 200,
        sub: `user:${devA.id}`,
        access: [{ type: 'repository', name: 'shop/app', actions: ['pull', 'push'] }],
      });
      // A developer PAT without registry:push only pulls.
      expect((await access(await pat(devA, ['registry:pull']))).access).toEqual([
        { type: 'repository', name: 'shop/app', actions: ['pull'] },
      ]);
      // Viewer: pull only.
      expect((await access(await pat(viewer, both))).access).toEqual([
        { type: 'repository', name: 'shop/app', actions: ['pull'] },
      ]);
      // No membership at all: no registry (docker login fails).
      expect((await access(await pat(outsider, both))).status).toBe(403);
      // The claimed cluster admin's PAT (membership, not the JWT role) acts as admin of every project.
      expect((await access(await pat(admin, both))).access).toEqual([
        { type: 'repository', name: 'shop/app', actions: ['pull', 'push'] },
        { type: 'repository', name: 'other/app', actions: ['pull', 'push'] },
      ]);
      // System repositories are never handed out to users.
      expect(
        (await access(await pat(admin, both), 'service=loadweaver-registry&scope=repository:lw-system/agent:pull'))
          .access,
      ).toEqual([]);
    });
  });

  describe('workspace drafts', () => {
    const create = async (user: Account, title: string, documents: string[] = []) => {
      const res = await api(
        'POST',
        '/drafts',
        { title, ops: documents.map((document) => ({ op: 'upsert', document })) },
        user.session,
      );

      expect(res.status).toBe(201);

      return res.json as { id: string; version: number; status: string };
    };

    it('lets exactly one of two parallel edits of the same version win (409 with the current draft)', async () => {
      const draft = await create(devA, 'parallel', [policy('base')]);

      // Shared: developer B of the same project sees and edits it.
      expect((await api('GET', `/drafts/${draft.id}`, undefined, devB.session)).status).toBe(200);
      // Not visible to a viewer or an outsider.
      expect((await api('GET', `/drafts/${draft.id}`, undefined, viewer.session)).status).toBe(404);
      expect((await api('GET', `/drafts/${draft.id}`, undefined, outsider.session)).status).toBe(404);

      const results = await Promise.all([
        api('PATCH', `/drafts/${draft.id}`, { title: 'by A' }, devA.session, { 'if-match': `"${draft.version}"` }),
        api('PATCH', `/drafts/${draft.id}`, { version: draft.version, title: 'by B' }, devB.session),
      ]);
      const ok = results.filter((r) => r.status === 200);
      const conflict = results.filter((r) => r.status === 409);

      expect(ok).toHaveLength(1);
      expect(conflict).toHaveLength(1);
      expect(ok[0].json.version).toBe(draft.version + 1);
      // The loser gets the current draft to rebase on.
      expect(conflict[0].json.draft).toMatchObject({
        id: draft.id,
        version: draft.version + 1,
        title: ok[0].json.title,
      });

      // Both version carriers are honoured: If-Match (weak and strong) and the body.
      const v2 = ok[0].json.version as number;
      const byHeader = await api('PATCH', `/drafts/${draft.id}`, { title: 'header' }, devB.session, {
        'if-match': `W/"${v2}"`,
      });

      expect(byHeader).toMatchObject({ status: 200, json: { version: v2 + 1, title: 'header' } });

      const byBody = await api(
        'PATCH',
        `/drafts/${draft.id}`,
        { version: v2 + 1, set: [{ op: 'upsert', document: policy('second') }] },
        devA.session,
      );

      expect(byBody.status).toBe(200);
      expect(byBody.json.ops.map((o: { name: string }) => o.name).sort()).toEqual(['base', 'second']);
      // Stale header / stale body / none at all.
      expect(
        (await api('PATCH', `/drafts/${draft.id}`, { title: 'x' }, devA.session, { 'if-match': '"1"' })).status,
      ).toBe(409);
      expect((await api('PATCH', `/drafts/${draft.id}`, { version: 1, title: 'x' }, devA.session)).status).toBe(409);
      expect((await api('PATCH', `/drafts/${draft.id}`, { title: 'x' }, devA.session)).status).toBe(400);
      // A viewer can't edit.
      expect(
        (await api('PATCH', `/drafts/${draft.id}`, { version: byBody.json.version, title: 'x' }, viewer.session))
          .status,
      ).toBe(404);

      expect((await audit('draft.update')).filter((e) => e.target === `draft/${draft.id}`)).toHaveLength(3);
    });

    it('turns two concurrent submits into exactly one plan', async () => {
      const draft = await create(devA, 'race', [policy('race')]);
      const results = await Promise.all([
        api('POST', `/drafts/${draft.id}/submit`, {}, devA.session, { 'if-match': `"${draft.version}"` }),
        api('POST', `/drafts/${draft.id}/submit`, { version: draft.version }, devB.session),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

      const plan = results.find((r) => r.status === 200)?.json;

      expect(plan).toMatchObject({ status: 'pending', source: { draft: { id: draft.id, title: 'race' } } });

      const plans = await db.query(`SELECT id FROM lw_plans WHERE source->'draft'->>'id' = $1`, [draft.id]);

      expect(plans).toEqual([{ id: plan.id }]);
      expect((await api('GET', `/drafts/${draft.id}`, undefined, devA.session)).json).toMatchObject({
        status: 'submitted',
        planId: plan.id,
      });
      expect((await audit('draft.submit')).filter((e) => e.target === `draft/${draft.id}`)).toHaveLength(1);
      // Submitted drafts can't be submitted again.
      expect(
        (await api('POST', `/drafts/${draft.id}/submit`, { version: draft.version + 1 }, devA.session)).status,
      ).toBe(409);
      // Leave nothing pending for the next tests.
      expect((await api('POST', `/plans/${plan.id}/cancel`, {})).status).toBeLessThan(300);
    });

    it('refuses a submit with 409 conflicts once the live resource moved (a concurrent apply)', async () => {
      const draft = await create(devA, 'stale', [policy('moved', 'shop', 'draft')]);

      expect(draft.version).toBe(1);
      // Someone else applies the same resource directly.
      await applyPlan(policy('moved', 'shop', 'live'));

      const plansBefore = (await db.query(`SELECT count(*)::int AS n FROM lw_plans`))[0].n;
      const refused = await api('POST', `/drafts/${draft.id}/submit`, { version: 1 }, devA.session);

      expect(refused.status).toBe(409);
      expect(refused.json.conflicts).toEqual([
        {
          key: 'Policy/shop/moved',
          kind: 'Policy',
          name: 'moved',
          project: 'shop',
          baseGeneration: 0,
          currentGeneration: 1,
        },
      ]);
      expect((await db.query(`SELECT count(*)::int AS n FROM lw_plans`))[0].n).toBe(plansBefore);
      // The draft stays open and editable at its version; the preview lists the same conflict.
      const current = await api('GET', `/drafts/${draft.id}`, undefined, devA.session);

      expect(current.json).toMatchObject({ status: 'open', version: 1 });

      const preview = await api('POST', `/drafts/${draft.id}/preview`, {}, devA.session);

      expect(preview.status).toBe(200);
      expect(preview.json.conflicts).toEqual([expect.objectContaining({ key: 'Policy/shop/moved' })]);
      // Rebased on the current generation, it submits.
      const rebased = await api(
        'PATCH',
        `/drafts/${draft.id}`,
        { version: 1, set: [{ op: 'upsert', document: policy('moved', 'shop', 'draft'), baseGeneration: 1 }] },
        devA.session,
      );

      expect(rebased.status).toBe(200);

      const submitted = await api(
        'POST',
        `/drafts/${draft.id}/submit`,
        { version: rebased.json.version },
        devA.session,
      );

      expect(submitted.status).toBe(200);
      expect((await api('POST', `/plans/${submitted.json.id}/cancel`, {})).status).toBeLessThan(300);
    });

    it('stores nothing for dry-run previews: no plan, no audit, no Git / notification rows', async () => {
      const tables = ['lw_plans', 'lw_plan_approvals', 'lw_git_pull_requests', 'lw_git_commits', 'webhook_deliveries'];
      const existing = (
        (await db.query(`SELECT t FROM unnest($1::text[]) AS t WHERE to_regclass(t) IS NOT NULL`, [tables])) as {
          t: string;
        }[]
      ).map((r) => r.t);
      const snapshot = async () => ({
        counts: Object.fromEntries(
          await Promise.all(
            existing.map(async (t) => [t, (await db.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n] as const),
          ),
        ),
        audit: (await db.query(`SELECT max(seq)::text AS seq FROM lw_audit_events`))[0].seq,
        resources: (await db.query(`SELECT count(*)::int AS n, sum(generation)::int AS g FROM lw_resources`))[0],
      });

      expect(existing).toEqual(expect.arrayContaining(['lw_plans', 'lw_git_pull_requests']));

      const draft = await create(devA, 'preview only', [policy('dry')]);
      const before = await snapshot();

      const dry = await api('POST', '/plans', { documents: policy('dry-plan'), dryRun: true }, devA.session);

      expect(dry.status).toBe(201);
      expect(dry.json).toMatchObject({ id: 'dry-run', dryRun: true, status: 'pending' });
      expect(dry.json.changes).toEqual([
        expect.objectContaining({ action: 'create', kind: 'Policy', name: 'dry-plan', project: 'shop' }),
      ]);

      const preview = await api('POST', `/drafts/${draft.id}/preview`, {}, devA.session);

      expect(preview.status).toBe(200);
      expect(preview.json).toMatchObject({ version: 1, conflicts: [], plan: { id: 'dry-run', dryRun: true } });
      expect(preview.json.topology).toBeDefined();

      const map = await api('POST', '/topology/preview', { documents: policy('dry-map') }, devA.session);

      expect(map.status).toBe(200);
      expect(map.json.plan).toMatchObject({ id: 'dry-run', dryRun: true });

      // A dry run still checks rights: a viewer can't preview changes.
      expect((await api('POST', '/plans', { documents: policy('nope'), dryRun: true }, viewer.session)).status).toBe(
        403,
      );

      expect(await snapshot()).toEqual(before);
      expect((await api('GET', `/drafts/${draft.id}`, undefined, devA.session)).json).toMatchObject({
        status: 'open',
        version: 1,
        planId: null,
      });
    });

    it('expires idle open drafts after 30 days and purges closed ones after 90 (audited)', async () => {
      const idle = await create(devB, 'idle', [policy('idle')]);
      const fresh = await create(devB, 'fresh', [policy('fresh')]);
      const closed = await create(devB, 'closed');

      expect(
        (await api('POST', `/drafts/${closed.id}/discard`, {}, devB.session, { 'if-match': `${closed.version}` })).json
          .status,
      ).toBe('discarded');
      await db.query(`UPDATE lw_drafts SET updated_at = now() - interval '31 days' WHERE id = $1`, [idle.id]);
      await db.query(`UPDATE lw_drafts SET updated_at = now() - interval '91 days' WHERE id = $1`, [closed.id]);

      const result = await app.get(DraftRetentionService).tick();

      expect(result).toEqual({ expired: 1, purged: 1 });
      expect((await api('GET', `/drafts/${idle.id}`, undefined, devB.session)).json).toMatchObject({
        status: 'discarded',
        version: idle.version + 1,
      });
      expect((await api('GET', `/drafts/${fresh.id}`, undefined, devB.session)).json.status).toBe('open');
      expect((await api('GET', `/drafts/${closed.id}`, undefined, devB.session)).status).toBe(404);
      // The owner sees the expired draft among the discarded ones.
      expect(
        (await api('GET', '/drafts?status=discarded', undefined, devB.session)).json.map((d: { id: string }) => d.id),
      ).toContain(idle.id);
      expect(await audit('draft.expire')).toEqual([
        {
          target: `draft/${idle.id}`,
          actor_id: null,
          details: expect.objectContaining({ owner: devB.id, title: 'idle', ops: 1, idleDays: 30 }),
        },
      ]);

      // Expired: no longer editable.
      expect(
        (await api('PATCH', `/drafts/${idle.id}`, { version: idle.version + 1, title: 'x' }, devB.session)).status,
      ).toBe(409);
      // Another pass finds nothing more (the 29-day boundary is respected).
      expect(await app.get(DraftRetentionService).tick(Date.now() + 29 * DAY_MS)).toEqual({ expired: 0, purged: 0 });
    });
  });

  describe('saved views', () => {
    const view = (user: Account, name: string, state: Record<string, unknown> = { filter: name }, scope = 'plans') =>
      api('POST', '/views', { scope, name, state }, user.session);

    it('keeps every owner to their own views (users and the API key)', async () => {
      const mine = await view(devA, 'mine');

      expect(mine.status).toBe(201);
      expect(mine.json).toMatchObject({ scope: 'plans', name: 'mine', state: { filter: 'mine' } });

      // A view of the API key's (another owner), written as the API key would.
      const [{ id: keyView }] = await db.query(
        `INSERT INTO lw_saved_views (owner, scope, name, state) VALUES ('api-key', 'plans', 'key view', '{}') RETURNING id`,
      );

      // B sees none of A's (nor the API key's) views and can't change or delete them.
      expect((await api('GET', '/views', undefined, devB.session)).json).toEqual([]);
      expect((await api('PATCH', `/views/${mine.json.id}`, { name: 'stolen' }, devB.session)).status).toBe(404);
      expect((await api('DELETE', `/views/${mine.json.id}`, undefined, devB.session)).status).toBe(404);
      expect(
        (await api('GET', '/views?scope=plans', undefined, devA.session)).json.map((v: { id: string }) => v.id),
      ).toEqual([mine.json.id]);
      // Not even the global admin reaches other owners' views.
      expect((await api('GET', '/views')).json).toEqual([]);
      expect((await api('DELETE', `/views/${keyView}`)).status).toBe(404);
      expect((await api('PATCH', `/views/${keyView}`, { name: 'x' }, devA.session)).status).toBe(404);

      // Same name per owner + scope: 409; B may use the same name.
      expect((await view(devA, 'mine')).status).toBe(409);
      expect((await view(devB, 'mine')).status).toBe(201);
      expect((await view(devA, 'mine', {}, 'audit')).status).toBe(201);

      // Owner changes and deletes.
      expect(
        (await api('PATCH', `/views/${mine.json.id}`, { name: 'renamed', state: { x: 1 } }, devA.session)).json,
      ).toMatchObject({ name: 'renamed', state: { x: 1 } });
      expect((await api('DELETE', `/views/${mine.json.id}`, undefined, devA.session)).status).toBe(204);

      const rows = await db.query(`SELECT owner, name FROM lw_saved_views ORDER BY owner, scope, name`);

      expect(rows).toEqual(
        expect.arrayContaining([
          { owner: 'api-key', name: 'key view' },
          { owner: devA.id, name: 'mine' },
          { owner: devB.id, name: 'mine' },
        ]),
      );
      expect(rows).toHaveLength(3);
    });

    it('audits view.create / view.update / view.delete with the acting user', async () => {
      const created = await view(viewer, 'audited');

      expect(created.status).toBe(201);
      expect((await api('PATCH', `/views/${created.json.id}`, { state: { y: 2 } }, viewer.session)).status).toBe(200);
      expect((await api('DELETE', `/views/${created.json.id}`, undefined, viewer.session)).status).toBe(204);

      for (const action of ['view.create', 'view.update', 'view.delete'])
        expect((await audit(action)).filter((e) => e.details.id === created.json.id)).toEqual([
          {
            target: 'view/plans/audited',
            actor_id: viewer.id,
            details: expect.objectContaining({ id: created.json.id }),
          },
        ]);

      expect((await audit('view.update')).find((e) => e.details.id === created.json.id)?.details).toMatchObject({
        state: true,
      });
    });

    it('refuses a state over 16 KiB and the 201st view of an owner with 400', async () => {
      const big = { blob: 'x'.repeat(16 * 1024) };

      expect((await view(outsider, 'big', big)).status).toBe(400);
      expect((await view(outsider, 'edge', { b: 'x'.repeat(16 * 1024 - 8) })).status).toBe(201);

      const small = await view(outsider, 'small');

      expect((await api('PATCH', `/views/${small.json.id}`, { state: big }, outsider.session)).status).toBe(400);

      // Fill up to 200 (two exist), then the next one is refused.
      await db.query(
        `INSERT INTO lw_saved_views (owner, scope, name, state)
         SELECT $1, 'contents', 'filler-' || i, '{}' FROM generate_series(1, 197) AS i`,
        [outsider.id],
      );
      expect((await view(outsider, 'last')).status).toBe(201);
      expect((await api('GET', '/views', undefined, outsider.session)).json).toHaveLength(200);

      const refused = await view(outsider, 'one-too-many');

      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.json)).toContain('at most 200 saved views');
      // Other owners are unaffected.
      expect((await view(devB, 'still-fine')).status).toBe(201);
    });
  });
});
