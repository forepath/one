import { createHmac, generateKeyPairSync } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';

import type { RequestWithUser } from '@forepath/identity/backend';
import {
  GitAccountsService,
  GitBotService,
  GitConnectionsService,
  GitPullRequestEntity,
  GitSyncService,
  PlansService,
  PlatformCredentialsService,
  ResourceEntity,
} from '@forepath/loadweaver/backend/feature-control-plane';
import { clusterSpecSchema } from '@forepath/loadweaver/shared/util-model';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../bootstrap';
import { MockGitHosting } from './git-bot.mocks';

/**
 * The plan bot (3.30) against mock GitHub and GitLab APIs and real Git repositories (smart HTTP via
 * `git http-backend`), all over HTTPS in the test process: pull requests are planned with locks, one sticky comment
 * and a status; commands need linked accounts and roles; apply needs a mergeable, approved PR and merges it; closing
 * releases locks; a merge without apply leaves "default branch ahead" in the next comment; OAuth account linking.
 */
const API_KEY = 'integration-test-api-key';
const OPS = 'b0b0b0b0-1c1e-4c39-9a51-3a3c1e0d0c01';
const DEV = 'b0b0b0b0-1c1e-4c39-9a51-3a3c1e0d0c02';
/** A project admin of botshop who didn't create it. */
const ADM = 'b0b0b0b0-1c1e-4c39-9a51-3a3c1e0d0c03';
const OCTO = { id: 4242, login: 'octo-ops' };
const APP_ID = 4711;

const group = (name: string, app: string, project: string) =>
  `apiVersion: loadweaver.com/v1\nkind: WorkloadGroup\nmetadata:\n  name: ${name}\n  project: ${project}\nspec:\n  selector:\n    matchLabels:\n      app: ${app}\n`;

describe('plan bot with GitHub and GitLab (mock providers)', () => {
  const hosting = new MockGitHosting();
  const env = { ...process.env };
  const secrets = new Map<string, string>();
  const app_ = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let app: INestApplication;
  let baseUrl: string;
  let github: { id: string; secret: string };
  let gitlab: { id: string; secret: string };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON response bodies
  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();

    return { status: res.status, json: text ? JSON.parse(text) : null };
  };

  const waitFor = async <T>(
    what: string,
    fn: () => Promise<T | undefined | null | false> | T | undefined | null | false,
    timeoutMs = 60_000,
  ): Promise<T> => {
    const end = Date.now() + timeoutMs;

    for (;;) {
      const value = await fn();

      if (value) return value as T;

      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);

      await new Promise((r) => setTimeout(r, 250));
    }
  };

  const user = (id: string) => ({ user: { id, roles: [], amr: ['pwd'] } }) as unknown as RequestWithUser;

  const githubHook = async (event: string, payload: object, delivery?: string) => {
    const body = JSON.stringify({ repository: { full_name: 'acme/infra' }, ...payload });
    const res = await fetch(`${baseUrl}/api/git/webhooks/${github.id}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': event,
        'x-hub-signature-256': `sha256=${createHmac('sha256', github.secret).update(body).digest('hex')}`,
        ...(delivery ? { 'x-github-delivery': delivery } : {}),
      },
      body,
    });

    expect(res.status).toBe(202);

    return (await res.json()) as { status: string; event: string };
  };

  const gitlabHook = async (event: string, payload: object) => {
    const res = await fetch(`${baseUrl}/api/git/webhooks/${gitlab.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gitlab-event': event, 'x-gitlab-token': gitlab.secret },
      body: JSON.stringify({ project: { path_with_namespace: 'group/infra' }, ...payload }),
    });

    expect(res.status).toBe(202);

    return (await res.json()) as { status: string; event: string };
  };

  const settled = () => app.get(GitBotService).idle();

  /** Opens (or pushes to) GitHub PR `n` with the files on branch `head`. */
  const githubPush = async (
    n: number,
    head: string,
    files: Record<string, string | null>,
    opened: boolean,
    author: { id: number; login: string } = { id: 1001, login: 'dev' },
  ) => {
    const sha = hosting.commit('acme/infra', head, files, `change ${head}`, opened ? 'main' : head);

    hosting.setRef('acme/infra', `refs/pull/${n}/head`, sha);
    hosting.github.pulls.set(n, {
      number: n,
      title: `PR ${n}`,
      head,
      sha,
      state: 'open',
      author: author.login,
      authorId: author.id,
      mergeable: true,
      draft: false,
    });
    await githubHook('pull_request', {
      action: opened ? 'opened' : 'synchronize',
      pull_request: hosting.githubPull(n),
    });
    await settled();

    return sha;
  };

  /**
   * A comment by `from` as GitHub stores it, and its webhook; the payload may claim another author (`claimed`) or
   * reuse an id (`id`): the bot reads the comment back from the API.
   */
  const githubComment = async (
    n: number,
    body: string,
    from: { id: number; login: string },
    options: { claimed?: { id: number; login: string }; createdAt?: Date; id?: number; delivery?: string } = {},
  ) => {
    const id = options.id ?? hosting.githubUserComment(n, body, from, options.createdAt);
    const claimed = options.claimed ?? from;

    await githubHook(
      'issue_comment',
      {
        action: 'created',
        issue: { number: n, pull_request: {} },
        comment: { id, body, user: { ...claimed, type: 'User' } },
      },
      options.delivery,
    );
    await settled();

    return id;
  };

  const comments = (n: number) => hosting.github.comments.get(n) ?? [];
  const sticky = (n: number) => comments(n).filter((c) => c.body.startsWith('<!-- loadweaver:plan -->'));
  const replies = (n: number) => comments(n).filter((c) => c.user === 'loadweaver[bot]' && !c.body.startsWith('<!--'));
  const lastReply = (n: number) => replies(n).at(-1)?.body ?? '';
  const prRow = async (connection: string, number: number) =>
    await app
      .get(DataSource)
      .getRepository(GitPullRequestEntity)
      .findOneOrFail({ where: { connectionId: connection, number } });
  const locksOf = async (planId: string | null): Promise<string[]> =>
    (
      (await app.get(DataSource).query('SELECT "scope" FROM "lw_resource_locks" WHERE "plan_id" = $1', [planId])) as {
        scope: string;
      }[]
    ).map((l) => l.scope);

  const applyPlan = async (id: string) => {
    const plan = (await api('GET', `/plans/${id}`)).json;

    if (plan.status === 'pending' && plan.createdBy === 'git')
      expect((await api('POST', `/plans/${id}/approve`)).status).toBeLessThan(300);

    expect((await api('POST', `/plans/${id}/apply`, {})).json.status).toBe('applied');
  };

  beforeAll(async () => {
    await hosting.start();
    hosting.setAppKey(app_.publicKey.export({ type: 'spki', format: 'pem' }) as string, APP_ID);
    Object.assign(process.env, {
      LOADWEAVER_PUBLIC_URL: 'https://lw.example.test',
      LOADWEAVER_CONSOLE_URL: 'https://console.example.test',
      // Many commands by one account in this suite; the limit itself is unit-tested.
      LOADWEAVER_GIT_BOT_COMMANDS_PER_10MIN: '1000',
    });

    secrets.set('secret://ops/github-app-key', app_.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string);
    secrets.set('secret://ops/github-oauth', 'github-client-secret');
    secrets.set('secret://ops/gitlab-oauth', 'gitlab-app-secret');
    secrets.set('secret://labshop/gitlab-token', 'glpat-mockproject');

    app = await createApp();
    jest.spyOn(app.get(PlatformCredentialsService), 'providerConfig').mockImplementation(async (ref: string) => {
      const value = secrets.get(ref);

      if (value === undefined) throw new Error(`${ref} has no value yet`);

      return { apiToken: value };
    });
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    // Projects with members: an operator (approves / applies) and a developer.
    const setup = await api('POST', '/plans', {
      documents: [
        'apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: botshop }\nspec: {}\n',
        'apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: labshop }\nspec: {}\n',
        group('web', 'web', 'botshop'),
        group('web', 'web', 'labshop'),
      ].join('---\n'),
    });

    expect({ status: setup.status, body: setup.status === 201 ? null : setup.json }).toEqual({
      status: 201,
      body: null,
    });
    await applyPlan(setup.json.id);

    for (const project of ['botshop', 'labshop']) {
      expect((await api('PUT', `/projects/${project}/members/${OPS}`, { role: 'operator' })).status).toBe(204);
      expect((await api('PUT', `/projects/${project}/members/${DEV}`, { role: 'developer' })).status).toBe(204);
    }

    expect((await api('PUT', `/projects/botshop/members/${ADM}`, { role: 'admin' })).status).toBe(204);

    // The GitHub App and the OAuth apps (Cluster.spec.git), on the mock hosts.
    const cluster = await app
      .get(DataSource)
      .getRepository(ResourceEntity)
      .findOneOrFail({ where: { kind: 'Cluster' } });
    const spec = clusterSpecSchema.parse({
      ...cluster.spec,
      git: {
        github: {
          appId: APP_ID,
          privateKey: 'secret://ops/github-app-key',
          clientId: 'Iv1.mock',
          clientSecret: 'secret://ops/github-oauth',
          webUrl: `${hosting.origin}/github/web`,
          apiUrl: `${hosting.origin}/github/api`,
          caCertificate: hosting.ca,
        },
        gitlab: {
          url: `${hosting.origin}/gitlab`,
          applicationId: 'gl-app',
          applicationSecret: 'secret://ops/gitlab-oauth',
          caCertificate: hosting.ca,
        },
      },
    });

    await app.get(DataSource).getRepository(ResourceEntity).update({ kind: 'Cluster', name: cluster.name }, { spec });

    // Both repositories start with the projects' current state.
    hosting.createRepo('acme/infra', { 'loadweaver/botshop/web.yaml': group('web', 'web', 'botshop') });
    hosting.createRepo('group/infra', { 'loadweaver/labshop/web.yaml': group('web', 'web', 'labshop') });
  }, 240_000);

  afterAll(async () => {
    // Suites share one database: the connections (and their pull request plans / locks) don't outlive this one.
    for (const connection of [github, gitlab]) if (connection) await api('DELETE', `/git/connections/${connection.id}`);

    await app?.close();
    await hosting.stop();
    process.env = env;
    rmSync(hosting.dir, { recursive: true, force: true });
  });

  it('links Git accounts through OAuth: signed single-use state, provider user only, fixed redirect, confirmed by the user', async () => {
    const accounts = app.get(GitAccountsService);
    /** The callback only records a pending link; the user who started the flow confirms it (L5). */
    const confirmFrom = (location: string | null) => {
      const nonce = new URL(location ?? 'https://x').searchParams.get('confirm');

      expect(nonce).toMatch(/^[\w-]{16,64}$/);

      return nonce as string;
    };

    hosting.oauthUsers.set('good-code', { id: 4242, login: 'octo-ops' });
    hosting.oauthUsers.set('lab-code', { id: 77, login: 'lab-ops' });

    const { url } = await accounts.authorize(user(OPS), 'github');
    const authorize = new URL(url);

    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${hosting.origin}/github/web/login/oauth/authorize`);
    expect(authorize.searchParams.get('client_id')).toBe('Iv1.mock');
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://lw.example.test/api/git/accounts/github/callback');

    const state = authorize.searchParams.get('state') as string;
    const callback = (provider: string, query: string) =>
      fetch(`${baseUrl}/api/git/accounts/${provider}/callback?${query}`, { redirect: 'manual' });
    const linked = await callback('github', `code=good-code&state=${encodeURIComponent(state)}`);

    expect(linked.status).toBe(302);
    expect(linked.headers.get('location')).toMatch(
      /^https:\/\/console\.example\.test\/account\/git-accounts\?confirm=/,
    );

    const nonce = confirmFrom(linked.headers.get('location'));

    // Nothing is linked yet; only the user who started the flow sees and confirms it.
    expect(await accounts.list(user(OPS))).toEqual([]);
    expect(await accounts.pending(user(OPS), nonce)).toMatchObject({ provider: 'github', login: 'octo-ops' });
    await expect(accounts.pending(user(DEV), nonce)).rejects.toThrow('expired or does not exist');
    await expect(accounts.confirm(user(DEV), nonce)).rejects.toThrow('expired or does not exist');
    expect(await accounts.confirm(user(OPS), nonce)).toMatchObject({ provider: 'github', providerUserId: '4242' });
    await expect(accounts.confirm(user(OPS), nonce)).rejects.toThrow('expired or does not exist');

    // Single use, tampering, the other provider's callback, and redirect parameters change nothing.
    for (const query of [
      `code=good-code&state=${encodeURIComponent(state)}`,
      `code=good-code&state=${encodeURIComponent(state.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))}`,
      `code=good-code&state=x&redirect_uri=https://evil.example`,
    ]) {
      const res = await callback('github', query);

      expect(res.headers.get('location')).toBe('https://console.example.test/account/git-accounts?error=invalid-state');
    }

    const fresh = new URL((await accounts.authorize(user(OPS), 'github')).url).searchParams.get('state') as string;

    expect(
      (await callback('gitlab', `code=lab-code&state=${encodeURIComponent(fresh)}`)).headers.get('location'),
    ).toContain('error=invalid-state');

    expect(await accounts.list(user(OPS))).toEqual([
      expect.objectContaining({ provider: 'github', providerUserId: '4242', login: 'octo-ops' }),
    ]);

    // GitLab (self-managed instance URL), and a denied authorization.
    const lab = new URL((await accounts.authorize(user(OPS), 'gitlab')).url);

    expect(lab.pathname).toBe('/gitlab/oauth/authorize');
    expect(lab.searchParams.get('scope')).toBe('read_user');

    const labNonce = confirmFrom(
      (
        await callback('gitlab', `code=lab-code&state=${encodeURIComponent(lab.searchParams.get('state') as string)}`)
      ).headers.get('location'),
    );

    await accounts.confirm(user(OPS), labNonce);

    // A pending link can be cancelled.
    const again = new URL((await accounts.authorize(user(OPS), 'gitlab')).url).searchParams.get('state') as string;
    const cancelled = confirmFrom(
      (await callback('gitlab', `code=lab-code&state=${encodeURIComponent(again)}`)).headers.get('location'),
    );

    await accounts.cancel(user(OPS), cancelled);
    await expect(accounts.confirm(user(OPS), cancelled)).rejects.toThrow('expired or does not exist');

    const denied = new URL((await accounts.authorize(user(DEV), 'github')).url).searchParams.get('state') as string;

    expect(
      (await callback('github', `error=access_denied&state=${encodeURIComponent(denied)}`)).headers.get('location'),
    ).toContain('error=denied');
    expect(await accounts.list(user(DEV))).toEqual([]);
    expect((await accounts.list(user(OPS))).map((a) => a.provider)).toEqual(['github', 'gitlab']);
  });

  it('connects the repositories (GitHub through the app, GitLab with a project token)', async () => {
    const created = await api('POST', '/git/connections', {
      project: 'botshop',
      provider: 'github',
      repoUrl: `${hosting.origin}/acme/infra.git`,
      apiUrl: `${hosting.origin}/github/api`,
      branch: 'main',
      path: 'loadweaver',
      mode: 'bidirectional',
      caCertificate: hosting.ca,
      approvalByMergeReview: true,
      // Only cluster admins (here: the API key) may let a connection use the GitHub App.
      githubApp: true,
    });

    expect(created.status).toBe(201);
    github = { id: created.json.id, secret: created.json.webhookSecret };

    const lab = await api('POST', '/git/connections', {
      project: 'labshop',
      provider: 'gitlab',
      repoUrl: `${hosting.origin}/group/infra.git`,
      apiUrl: `${hosting.origin}/gitlab/api/v4`,
      branch: 'main',
      path: 'loadweaver',
      mode: 'bidirectional',
      credentials: 'secret://labshop/gitlab-token',
      caCertificate: hosting.ca,
    });

    expect(lab.status).toBe(201);
    gitlab = { id: lab.json.id, secret: lab.json.webhookSecret };

    expect((await api('POST', `/git/connections/${github.id}/sync`)).json).toMatchObject({ state: 'no-changes' });
    expect((await api('POST', `/git/connections/${gitlab.id}/sync`)).json).toMatchObject({ state: 'no-changes' });
    // Git over HTTPS used the app's installation token.
    expect(hosting.gitAuth).toContain(`Basic ${Buffer.from('x-access-token:ghs_mockinstallation').toString('base64')}`);
  });

  it('plans an opened pull request: plan with the PR source, PR locks, one sticky comment, a pending status', async () => {
    const sha = await githubPush(
      1,
      'feature-1',
      { 'loadweaver/botshop/api.yaml': group('api', 'api', 'botshop') },
      true,
    );
    const [comment] = sticky(1);

    expect(sticky(1)).toHaveLength(1);
    expect(comment.body).toContain(`### Loadweaver plan: \`botshop\` at \`${sha.slice(0, 8)}\``);
    expect(comment.body).toContain('- `+` create WorkloadGroup `botshop/api`');
    expect(comment.body).toContain('needs an approval for `botshop`');

    const pr = await prRow(github.id, 1);
    const plan = (await api('GET', `/plans/${pr.planId}`)).json;

    expect(plan.source).toMatchObject({
      kind: 'git',
      connection: github.id,
      commit: sha,
      ref: 'refs/pull/1/head',
      pr: 1,
    });
    expect(comment.body).toContain(`https://console.example.test/plans/${plan.id}`);
    expect(comment.body).toContain(`https://console.example.test/topology?plan=${plan.id}`);
    expect(await locksOf(plan.id)).toEqual(['WorkloadGroup/botshop/api']);
    await waitFor('pending status', () => hosting.github.statuses.get(sha)?.get('loadweaver/plan') === 'pending');

    // The console can't apply a PR's plan: that is `loadweaver apply` on the PR.
    const direct = await api('POST', `/plans/${plan.id}/apply`, {});

    expect(direct.status).toBe(409);
    expect(JSON.stringify(direct.json.blockers)).toContain('belongs to pull request #1');
  });

  it('updates the same comment on the next push; the locks move to the new plan', async () => {
    const before = (await prRow(github.id, 1)).planId;
    const sha = await githubPush(
      1,
      'feature-1',
      { 'loadweaver/botshop/api.yaml': group('api', 'api-v2', 'botshop') },
      false,
    );

    expect(sticky(1)).toHaveLength(1);
    expect(sticky(1)[0].body).toContain(`at \`${sha.slice(0, 8)}\``);

    const after = (await prRow(github.id, 1)).planId;

    expect(after).not.toBe(before);
    expect((await api('GET', `/plans/${before}`)).json.status).toBe('discarded');
    expect(await locksOf(before)).toEqual([]);
    expect(await locksOf(after)).toEqual(['WorkloadGroup/botshop/api']);
  });

  it('shows the locks of other pull requests', async () => {
    await githubPush(2, 'feature-2', { 'loadweaver/botshop/api.yaml': group('api', 'api-other', 'botshop') }, true);

    const body = sticky(2)[0].body;

    expect(body).toContain('#### Locked by others (1)');
    expect(body).toContain('`WorkloadGroup/botshop/api` by pull request #1');
    expect(await locksOf((await prRow(github.id, 2)).planId)).toEqual([]);
  });

  it('answers commands of unlinked accounts and invalid commands with the reason', async () => {
    await githubComment(1, 'loadweaver apply', { id: 999, login: 'stranger' });
    expect(lastReply(1)).toContain(
      '@stranger `loadweaver apply`: your GitHub account is not linked to a Loadweaver user',
    );

    await githubComment(1, 'loadweaver deploy', { id: 4242, login: 'octo-ops' });
    expect(lastReply(1)).toContain('unknown command');
    expect(hosting.github.reactions.map((r) => r.content)).toEqual(expect.arrayContaining(['eyes', '-1']));
  });

  it('refuses to apply a pull request that is not mergeable', async () => {
    const sha = hosting.github.pulls.get(1)?.sha as string;

    hosting.github.extraStatuses.set(sha, [{ context: 'ci/build', state: 'failure' }]);
    await githubComment(1, 'loadweaver apply', { id: 4242, login: 'octo-ops' });
    expect(lastReply(1)).toContain('the pull request is not mergeable');
    expect(lastReply(1)).toContain("check 'ci/build' is failure");
    expect((await api('GET', `/plans/${(await prRow(github.id, 1)).planId}`)).json.status).toBe('pending');
  });

  it('applies on `loadweaver apply` by a linked operator (PR review as approval), merges, and reports', async () => {
    const pr = hosting.github.pulls.get(1);
    const sha = pr?.sha as string;

    hosting.github.extraStatuses.set(sha, [{ context: 'ci/build', state: 'success' }]);
    hosting.github.reviews.set(1, [{ user: { id: 4242, login: 'octo-ops' }, state: 'APPROVED', commit_id: sha }]);
    await githubComment(1, 'loadweaver apply', { id: 4242, login: 'octo-ops' });

    const planId = (await prRow(github.id, 1)).planId as string;

    await waitFor('apply result', () => comments(1).some((c) => c.body.includes(`Applied plan ${planId.slice(0, 8)}`)));
    expect((await api('GET', `/plans/${planId}`)).json).toMatchObject({
      status: 'applied',
      approvals: [expect.objectContaining({ project: 'botshop', userId: OPS })],
    });
    expect((await api('GET', '/resources/WorkloadGroup/api?project=botshop')).json.spec.selector.matchLabels.app).toBe(
      'api-v2',
    );
    expect(pr?.state).toBe('merged');
    expect(hosting.ref('acme/infra', 'refs/heads/main')).toBe(sha);
    expect(sticky(1)[0].body).toContain(':rocket: **Applied**');
    expect(sticky(1)[0].body).toContain('The pull request was merged');
    await waitFor('success status', () => hosting.github.statuses.get(sha)?.get('loadweaver/plan') === 'success');
    expect(await locksOf(planId)).toEqual([]);

    // The merge reaches the default branch: in sync, nothing ahead.
    await githubHook('pull_request', { action: 'closed', pull_request: hosting.githubPull(1) });
    await settled();
    await waitFor('default branch synced', async () =>
      ['no-changes', 'unchanged'].includes((await api('POST', `/git/connections/${github.id}/sync`)).json.state),
    );
    expect((await api('GET', '/drift')).json.gitAhead).toEqual([]);
  });

  it('`loadweaver plan` takes the released locks; `loadweaver unlock` gives them back', async () => {
    await githubComment(2, 'loadweaver plan', { id: 4242, login: 'octo-ops' });

    const planId = (await prRow(github.id, 2)).planId as string;

    expect(await locksOf(planId)).toEqual(['WorkloadGroup/botshop/api']);
    expect(sticky(2)[0].body).toContain('Re-planned by @​octo-ops');
    expect(sticky(2)[0].body).not.toContain('Locked by others');

    await githubComment(2, 'loadweaver unlock', { id: 4242, login: 'octo-ops' });
    expect(lastReply(2)).toContain('locks released and the plan discarded');
    expect(await locksOf(planId)).toEqual([]);
    expect((await api('GET', `/plans/${planId}`)).json.status).toBe('discarded');
  });

  it('releases the locks when a pull request is closed', async () => {
    await githubPush(3, 'feature-3', { 'loadweaver/botshop/cache.yaml': group('cache', 'cache', 'botshop') }, true);

    const planId = (await prRow(github.id, 3)).planId as string;

    expect(await locksOf(planId)).toEqual(['WorkloadGroup/botshop/cache']);

    const pull = hosting.github.pulls.get(3);

    if (pull) pull.state = 'closed';

    await githubHook('pull_request', { action: 'closed', pull_request: hosting.githubPull(3) });
    await settled();
    expect(await locksOf(planId)).toEqual([]);
    expect((await api('GET', `/plans/${planId}`)).json.status).toBe('discarded');
    expect(sticky(3)[0].body).toContain('Closed: the locks are released');
  });

  it('a merge without apply applies nothing and shows "default branch ahead" in the next PR comment', async () => {
    const sha = await githubPush(
      4,
      'feature-4',
      { 'loadweaver/botshop/queue.yaml': group('queue', 'queue', 'botshop') },
      true,
    );
    const pull = hosting.github.pulls.get(4);

    // Merged on GitHub, without `loadweaver apply`.
    hosting.setRef('acme/infra', 'refs/heads/main', sha);

    if (pull) pull.state = 'merged';

    await githubHook('pull_request', { action: 'closed', pull_request: hosting.githubPull(4) });
    await settled();
    expect(sticky(4)[0].body).toContain("Merged without 'loadweaver apply': nothing was applied");
    expect((await api('GET', '/resources/WorkloadGroup/queue?project=botshop')).status).toBe(404);

    const ahead = await waitFor('ahead drift', async () =>
      ((await api('GET', '/drift')).json.gitAhead as { connection: string; commit: string }[]).find(
        (a) => a.connection === github.id && a.commit === sha,
      ),
    );

    expect(ahead).toMatchObject({ state: 'pending' });

    await githubPush(5, 'feature-5', { 'loadweaver/botshop/docs.yaml': group('docs', 'docs', 'botshop') }, true);
    expect(sticky(5)[0].body).toContain(`**default branch ahead of cluster**: \`${sha.slice(0, 8)}\` is pending`);
  });

  it('plans pull requests from forks only on `loadweaver plan` by a linked account', async () => {
    const sha = hosting.commit(
      'acme/infra',
      'fork-6',
      { 'loadweaver/botshop/fork.yaml': group('fork', 'fork', 'botshop') },
      'from a fork',
      'main',
    );

    hosting.setRef('acme/infra', 'refs/pull/6/head', sha);
    hosting.github.pulls.set(6, {
      number: 6,
      title: 'PR 6',
      head: 'fork-6',
      sha,
      state: 'open',
      author: 'outsider',
      mergeable: true,
      draft: false,
      forkOf: 'outsider/infra',
    });
    await githubHook('pull_request', { action: 'opened', pull_request: hosting.githubPull(6) });
    await settled();
    expect((await prRow(github.id, 6)).planId).toBeNull();
    expect(sticky(6)[0].body).toContain('comes from a fork');

    await githubComment(6, 'loadweaver plan', { id: 4242, login: 'octo-ops' });

    const planId = (await prRow(github.id, 6)).planId as string;

    expect(planId).toEqual(expect.any(String));
    expect(sticky(6)[0].body).toContain('- `+` create WorkloadGroup `botshop/fork`');

    // A new push to the fork drops that plan until it is planned again.
    const next = hosting.commit(
      'acme/infra',
      'fork-6',
      { 'loadweaver/botshop/fork.yaml': group('fork', 'fork-2', 'botshop') },
      'more',
      'fork-6',
    );
    const pull = hosting.github.pulls.get(6);

    hosting.setRef('acme/infra', 'refs/pull/6/head', next);

    if (pull) pull.sha = next;

    await githubHook('pull_request', { action: 'synchronize', pull_request: hosting.githubPull(6) });
    await settled();
    expect((await prRow(github.id, 6)).planId).toBeNull();
    expect((await api('GET', `/plans/${planId}`)).json.status).toBe('discarded');
    expect(await locksOf(planId)).toEqual([]);
  });

  it('supersedes the UI plan of an authoritative scope with the plan of its pull request', async () => {
    expect((await api('PATCH', `/git/connections/${github.id}`, { mode: 'authoritative' })).json.mode).toBe(
      'authoritative',
    );

    // Opening the pull request is slow: the plan is answered at once, the link follows (M5).
    hosting.github.createPullDelayMs = 3_000;

    const started = Date.now();
    const ui = await api('POST', '/plans', { documents: group('web', 'web-ui', 'botshop') });

    expect(ui.status).toBe(201);
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(ui.json.source.pullRequests).toEqual([
      { connection: github.id, branch: `loadweaver/plan-${ui.json.id}`, pending: true },
    ]);

    await app.get(GitSyncService).pullRequestsOpened();
    hosting.github.createPullDelayMs = 0;

    const opened = (await api('GET', `/plans/${ui.json.id}`)).json.source.pullRequests[0];

    expect(opened).toMatchObject({ connection: github.id, number: expect.any(Number), url: expect.any(String) });
    expect(opened.pending).toBeUndefined();

    await githubHook('pull_request', { action: 'opened', pull_request: hosting.githubPull(opened.number) });
    await settled();

    const prPlan = (await prRow(github.id, opened.number)).planId as string;

    expect((await api('GET', `/plans/${ui.json.id}`)).json).toMatchObject({
      status: 'discarded',
      source: expect.objectContaining({ supersededBy: prPlan }),
    });
    expect((await api('GET', `/plans/${prPlan}`)).json.source).toMatchObject({
      supersedes: ui.json.id,
      pr: opened.number,
    });
    expect((await api('PATCH', `/git/connections/${github.id}`, { mode: 'bidirectional' })).status).toBe(200);
  });

  it('GitLab: plans a merge request, `loadweaver approve` and `loadweaver apply` by a linked operator, merges', async () => {
    const sha = hosting.commit(
      'group/infra',
      'mr-1',
      { 'loadweaver/labshop/api.yaml': group('api', 'api', 'labshop') },
      'add api',
      'main',
    );

    hosting.setRef('group/infra', 'refs/merge-requests/1/head', sha);
    hosting.gitlab.mrs.set(1, {
      number: 1,
      title: 'Add api',
      head: 'mr-1',
      sha,
      state: 'open',
      author: 'dev',
      detailed: 'mergeable',
    });

    const mrHook = (action: string) =>
      gitlabHook('Merge Request Hook', {
        user: { username: 'dev' },
        object_attributes: {
          iid: 1,
          action,
          title: 'Add api',
          source_branch: 'mr-1',
          target_branch: 'main',
          last_commit: { id: sha },
        },
      });
    const note = async (text: string, from: { id: number; username: string }) => {
      const id = hosting.gitlabUserNote(1, text, from);

      expect(
        await gitlabHook('Note Hook', {
          user: from,
          merge_request: { iid: 1 },
          object_attributes: { id, noteable_type: 'MergeRequest', note: text },
        }),
      ).toEqual({ status: 'queued', event: 'comment' });
      await settled();
    };
    const notes = () => (hosting.gitlab.notes.get(1) ?? []).filter((n) => n.user === 'loadweaver-bot');

    expect(await mrHook('open')).toEqual({ status: 'queued', event: 'pull-request' });
    await settled();
    expect(notes().filter((n) => n.body.startsWith('<!-- loadweaver:plan -->'))).toHaveLength(1);
    expect(hosting.gitlab.statuses.get(sha)).toEqual([
      expect.objectContaining({ name: 'loadweaver/plan', status: 'pending' }),
    ]);

    // Unlinked accounts can't approve.
    await note('loadweaver approve', { id: 999, username: 'lab-stranger' });
    expect(notes().at(-1)?.body).toContain('not linked');

    await note('loadweaver approve', { id: 77, username: 'lab-ops' });
    expect(notes().at(-1)?.body).toContain('`loadweaver approve`: approved');

    await note('loadweaver apply', { id: 77, username: 'lab-ops' });

    const planId = (await prRow(gitlab.id, 1)).planId as string;

    await waitFor('applied + merged', () => notes().some((n) => n.body.includes(`Applied plan ${planId.slice(0, 8)}`)));
    expect(hosting.gitlab.mrs.get(1)?.state).toBe('merged');
    expect(hosting.ref('group/infra', 'refs/heads/main')).toBe(sha);
    expect((await api('GET', '/resources/WorkloadGroup/api?project=labshop')).status).toBe(200);
    expect(hosting.gitlab.awards.map((a) => a.name)).toEqual(expect.arrayContaining(['eyes', 'thumbsup']));
  });

  it('GitLab: approvals from before the current head are ignored unless the project resets them on push (H3)', async () => {
    expect((await api('PATCH', `/git/connections/${gitlab.id}`, { approvalByMergeReview: true })).status).toBe(200);

    const sha = hosting.commit(
      'group/infra',
      'mr-2',
      { 'loadweaver/labshop/worker.yaml': group('worker', 'worker', 'labshop') },
      'add worker',
      'main',
    );
    const pushedAt = new Date();

    hosting.setRef('group/infra', 'refs/merge-requests/2/head', sha);
    hosting.gitlab.mrs.set(2, {
      number: 2,
      title: 'Add worker',
      head: 'mr-2',
      sha,
      state: 'open',
      author: 'dev',
      detailed: 'mergeable',
    });
    hosting.gitlab.versions.set(2, [{ head_commit_sha: sha, created_at: pushedAt.toISOString() }]);
    // lab-ops approved an earlier head an hour ago; GitLab kept the approval across the push.
    hosting.gitlab.approvals.set(2, [{ id: 77, username: 'lab-ops' }]);
    hosting.gitlabUserNote(
      2,
      'approved this merge request',
      { id: 77, username: 'lab-ops' },
      {
        system: true,
        createdAt: new Date(pushedAt.getTime() - 3_600_000),
      },
    );

    const mrNote = async (text: string) => {
      const id = hosting.gitlabUserNote(2, text, { id: 77, username: 'lab-ops' });

      await gitlabHook('Note Hook', {
        user: { id: 77, username: 'lab-ops' },
        merge_request: { iid: 2 },
        object_attributes: { id, noteable_type: 'MergeRequest', note: text },
      });
      await settled();
    };
    const botNotes = () => (hosting.gitlab.notes.get(2) ?? []).filter((n) => n.user === 'loadweaver-bot');

    await gitlabHook('Merge Request Hook', {
      user: { username: 'dev' },
      object_attributes: {
        iid: 2,
        action: 'open',
        source_branch: 'mr-2',
        target_branch: 'main',
        last_commit: { id: sha },
      },
    });
    await settled();

    const planId = (await prRow(gitlab.id, 2)).planId as string;

    await mrNote('loadweaver apply');
    expect(botNotes().at(-1)?.body).toContain('needs an approval');
    expect(botNotes().at(-1)?.body).toContain('1 GitLab approval(s) ignored');
    expect((await api('GET', `/plans/${planId}`)).json.status).toBe('pending');

    // Approved again after the push: it counts.
    hosting.gitlabUserNote(2, 'approved this merge request', { id: 77, username: 'lab-ops' }, { system: true });
    await mrNote('loadweaver apply');
    await waitFor('applied', () => botNotes().some((n) => n.body.includes(`Applied plan ${planId.slice(0, 8)}`)));
    expect(hosting.gitlab.mrs.get(2)?.state).toBe('merged');
    expect((await api('PATCH', `/git/connections/${gitlab.id}`, { approvalByMergeReview: false })).status).toBe(200);
  });

  it('ignores replayed deliveries and comments, and acts on the comment as the provider has it (H1)', async () => {
    await githubPush(7, 'feature-7', { 'loadweaver/botshop/h1.yaml': group('h1', 'h1', 'botshop') }, true);

    const pull = { action: 'synchronize', pull_request: hosting.githubPull(7) };

    expect(await githubHook('pull_request', pull, 'delivery-7')).toEqual({ status: 'queued', event: 'pull-request' });
    await settled();
    expect(await githubHook('pull_request', pull, 'delivery-7')).toEqual({ status: 'ignored', event: 'pull-request' });

    // A comment acts once, also when delivered again (another delivery id).
    const before = replies(7).length;
    const id = await githubComment(7, 'loadweaver plan', OCTO, { delivery: 'delivery-c1' });

    expect(replies(7)).toHaveLength(before + 1);
    await githubComment(7, 'loadweaver plan', OCTO, { id, delivery: 'delivery-c2' });
    expect(replies(7)).toHaveLength(before + 1);

    // A forged payload claiming a linked operator: the comment's real author (from the API) counts.
    await githubComment(7, 'loadweaver approve', { id: 999, login: 'stranger' }, { claimed: OCTO });
    expect(lastReply(7)).toContain('@stranger `loadweaver approve`: your GitHub account is not linked');

    // A comment older than the current plan doesn't act on it.
    await githubComment(7, 'loadweaver approve', OCTO, { createdAt: new Date(Date.now() - 3_600_000) });
    expect(lastReply(7)).toContain('this comment was written before the current plan');
    expect((await api('GET', `/plans/${(await prRow(github.id, 7)).planId}`)).json.approvals).toEqual([]);

    // Another repository's delivery is ignored (L4).
    const body = JSON.stringify({ repository: { full_name: 'acme/other' }, ...pull });
    const other = await fetch(`${baseUrl}/api/git/webhooks/${github.id}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': `sha256=${createHmac('sha256', github.secret).update(body).digest('hex')}`,
      },
      body,
    });

    expect(await other.json()).toEqual({ status: 'ignored', event: 'pull-request' });
  });

  it("the pull request's author can't approve it, nor does their review count (H2)", async () => {
    const sha = await githubPush(
      8,
      'feature-8',
      { 'loadweaver/botshop/h2.yaml': group('h2', 'h2', 'botshop') },
      true,
      OCTO,
    );
    const planId = (await prRow(github.id, 8)).planId as string;

    expect((await api('GET', `/plans/${planId}`)).json.source.authors).toEqual([OPS]);

    await githubComment(8, 'loadweaver approve', OCTO);
    expect(lastReply(8)).toContain('the author of a change cannot approve it');
    await expect(app.get(PlansService).approve(planId, user(OPS))).rejects.toThrow('cannot approve');

    hosting.github.reviews.set(8, [{ user: OCTO, state: 'APPROVED', commit_id: sha }]);
    await githubComment(8, 'loadweaver apply', OCTO);
    expect(lastReply(8)).toContain("needs an approval from an operator or admin who didn't create the plan");
    expect((await api('GET', `/plans/${planId}`)).json).toMatchObject({ status: 'pending', approvals: [] });
  });

  it('required reviews (branch protection) block the apply like checks do (M2)', async () => {
    hosting.github.reviewDecision.set(7, 'REVIEW_REQUIRED');
    await githubComment(7, 'loadweaver apply', OCTO);
    expect(lastReply(7)).toContain('the pull request is not mergeable');
    expect(lastReply(7)).toContain('it needs the reviews GitHub requires');

    hosting.github.reviewDecision.set(7, 'CHANGES_REQUESTED');
    await githubComment(7, 'loadweaver apply', OCTO);
    expect(lastReply(7)).toContain('a reviewer requested changes');
    hosting.github.reviewDecision.delete(7);
  });

  it('merges exactly the applied commit: a head that moved meanwhile is not merged (M1)', async () => {
    // The default branch's pending plan (the merge without apply above) locks `queue`: discarded, then re-planned.
    const ahead = ((await api('GET', '/drift')).json.gitAhead as { connection: string; planId: string | null }[]).find(
      (a) => a.connection === github.id,
    );

    if (ahead?.planId) {
      const discarded = await api('POST', `/plans/${ahead.planId}/discard`);

      expect([discarded.status, discarded.json?.status]).toEqual([expect.any(Number), 'discarded']);
    }

    // Other open pull requests branched after that merge lock `queue` too.
    for (const n of [5, 8]) await githubComment(n, 'loadweaver unlock', OCTO);

    await githubComment(7, 'loadweaver plan', OCTO);

    const pull = hosting.github.pulls.get(7);
    const sha = pull?.sha as string;
    const planId = (await prRow(github.id, 7)).planId as string;

    hosting.github.reviews.set(7, [{ user: OCTO, state: 'APPROVED', commit_id: sha }]);
    hosting.github.moveHeadOnMerge.add(7);
    await githubComment(7, 'loadweaver apply', OCTO);
    expect(
      replies(7)
        .map((c) => c.body)
        .join('\n'),
    ).toContain(`applying plan ${planId.slice(0, 8)}`);
    await waitFor('apply result', () => comments(7).some((c) => c.body.includes(`Applied plan ${planId.slice(0, 8)}`)));

    expect(lastReply(7)).toContain('Merging failed');
    expect(lastReply(7)).toContain('it needs a new plan');
    expect(pull?.state).toBe('open');
    expect(hosting.ref('acme/infra', 'refs/heads/main')).not.toBe(pull?.sha);
  });

  it('after an apply limited to a path, the pull request is not merged (L9)', async () => {
    const sha = await githubPush(
      9,
      'feature-9',
      {
        'loadweaver/botshop/l9/a.yaml': group('l9a', 'l9a', 'botshop'),
        'loadweaver/botshop/l9b.yaml': group('l9b', 'l9b', 'botshop'),
      },
      true,
    );

    await githubComment(9, 'loadweaver plan loadweaver/botshop/l9', OCTO);

    const planId = (await prRow(github.id, 9)).planId as string;

    expect((await api('GET', `/plans/${planId}`)).json.source.limited).toBe('loadweaver/botshop/l9');
    hosting.github.reviews.set(9, [{ user: OCTO, state: 'APPROVED', commit_id: sha }]);
    await githubComment(9, 'loadweaver apply', OCTO);
    await waitFor('apply result', () => comments(9).some((c) => c.body.includes(`Applied plan ${planId.slice(0, 8)}`)));
    expect(lastReply(9)).toContain('Only part of the pull request was applied');
    expect(hosting.github.pulls.get(9)?.state).toBe('open');
  });

  it('pointing a connection with memberships from Git elsewhere needs who may manage admins (M3)', async () => {
    const connections = app.get(GitConnectionsService);

    expect(
      (await api('PATCH', `/git/connections/${github.id}`, { membershipsFromGit: true })).json.membershipsFromGit,
    ).toBe(true);

    // A project admin who didn't create the project: the flag goes off with the change, and can't be kept on.
    await expect(
      connections.update(user(ADM), github.id, { caCertificate: `${hosting.ca}\n`, membershipsFromGit: true }),
    ).rejects.toThrow('only cluster admins and the project creator');
    expect(
      (await connections.update(user(ADM), github.id, { caCertificate: `${hosting.ca}\n` })).membershipsFromGit,
    ).toBe(false);
    // The GitHub App stays a cluster admin's decision (unchanged repository / API: kept).
    expect((await api('GET', `/git/connections/${github.id}`)).json.githubApp).toBe(true);
  });

  it('audits every bot command with PR, commit and user', async () => {
    const audit = (await api('GET', '/audit?action=git.*&limit=500')).json.entries as {
      action: string;
      actorId: string | null;
      details: Record<string, unknown>;
    }[];
    const text = JSON.stringify(audit);

    for (const action of [
      'git.account.link',
      'git.pr.planned',
      'git.pr.applied',
      'git.pr.closed',
      'git.pr.merged',
      'git.command.apply',
      'git.command.plan',
      'git.command.unlock',
      'git.command.approve',
      'git.command.invalid',
      'git.review-approval',
    ])
      expect(text).toContain(action);

    expect(
      audit.find(
        (e) =>
          e.action === 'git.command.apply' &&
          e.details['outcome'] === 'done' &&
          e.details['login'] === 'octo-ops' &&
          e.details['pr'] === 1,
      ),
    ).toMatchObject({
      actorId: OPS,
      details: expect.objectContaining({ pr: 1, commit: expect.stringMatching(/^[0-9a-f]{40}$/), login: 'octo-ops' }),
    });
    expect(text).not.toContain('ghs_mockinstallation');
    expect(text).not.toContain('gho_good-code');
  });
});
