import { execFileSync } from 'node:child_process';
import { createHmac, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import {
  GitConnectionEntity,
  GitSyncService,
  MasterKeyService,
  PlatformCredentialsService,
  providerRequest,
} from '@forepath/loadweaver/backend/feature-control-plane';
import { generateAgeIdentity } from '@forepath/loadweaver/shared/util-secrets';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../bootstrap';
import { docker } from './postgres.container';

/**
 * GitOps against a real Gitea (3.29): clone / push over HTTPS (private CA) and SSH (deploy key, pinned host key),
 * polling sync → plans with their source, commit statuses through the Gitea API, secret scanning, export,
 * bidirectional commit-back, authoritative pull requests, and signed webhooks. Gitea can't reach the test process,
 * so webhook deliveries are sent by the test with the derived secret.
 */
const GITEA_IMAGE =
  'docker.io/gitea/gitea:1.27.3-rootless@sha256:1c17ecaead42eb3b5391553d8708103a4beb0e86edf5b9ebc1eb269c318845f2';
const API_KEY = 'integration-test-api-key';
const ADMIN = { user: 'lwadmin', password: 'Lw-admin-pass1!', email: 'lwadmin@example.test' };

// Test secrets are assembled at runtime so this file doesn't trip the repository's own secret scanning.
const FAKE_GITHUB_TOKEN = ['gh', 'p_', 'Xk7Qm2Rt9Vb4Nc8Lp3Zs6Wd1Fh5Jy0Ga2Eu7'].join('');

function sshKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const field = (b: Buffer) => {
    const length = Buffer.alloc(4);

    length.writeUInt32BE(b.length);

    return Buffer.concat([length, b]);
  };
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x as string, 'base64url'),
    Buffer.from(jwk.y as string, 'base64url'),
  ]);
  const blob = Buffer.concat([field(Buffer.from('ecdsa-sha2-nistp256')), field(Buffer.from('nistp256')), field(point)]);

  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicKey: `ecdsa-sha2-nistp256 ${blob.toString('base64')}`,
  };
}

/** The SOPS lab image of util-secrets (digest-pinned sops + checksum-pinned age), built from its Dockerfile. */
const SOPS_LAB_IMAGE = 'loadweaver-sops-lab:test';

function buildSopsLab(): void {
  execFileSync('docker', ['build', '-q', '-t', SOPS_LAB_IMAGE, '-'], {
    input: readFileSync(
      resolve(
        __dirname,
        '../../../../../libs/domains/loadweaver/shared/util-secrets/src/integration/sops-lab.Dockerfile',
      ),
    ),
    stdio: ['pipe', 'ignore', 'inherit'],
  });
}

/** Encrypts YAML with the real `sops` to an age recipient (data through stdin / stdout, no bind mounts). */
function sopsEncrypt(yaml: string, recipient: string): string {
  return execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-i',
      '-e',
      'RECIPIENT',
      SOPS_LAB_IMAGE,
      'sh',
      '-c',
      'set -e; mkdir -p /tmp/w; cd /tmp/w; cat > in.yaml; sops encrypt --age "$RECIPIENT" in.yaml',
    ],
    { input: yaml, env: { ...process.env, RECIPIENT: recipient }, stdio: 'pipe' },
  ).toString('utf8');
}

const group = (name: string, app: string, project = 'gitshop') =>
  `apiVersion: loadweaver.com/v1\nkind: WorkloadGroup\nmetadata:\n  name: ${name}\n  project: ${project}\nspec:\n  selector:\n    matchLabels:\n      app: ${app}\n`;

describe('GitOps with Gitea (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const container = `lw-it-gitea-${run}`;
  const dir = mkdtempSync(join(tmpdir(), 'lw-it-gitea-'));
  let app: INestApplication;
  let baseUrl: string;
  let giteaUrl: string;
  let sshPort: string;
  let ca: string;
  let token: string;
  let connectionId: string;
  /**
   * Secret values by reference. The lab has no members holding the master key, so the secret store can't seal values;
   * the credential lookup (the only way Git reads secrets) is served from here instead.
   */
  const secrets = new Map<string, string>();

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

  const gitea = (method: string, path: string, body?: unknown) =>
    providerRequest(
      { caCertificate: ca },
      method,
      `${giteaUrl}/api/v1${path}`,
      { authorization: `token ${token}` },
      body,
    );

  const putFile = async (repo: string, path: string, content: string, message: string) => {
    const existing = await gitea('GET', `/repos/${ADMIN.user}/${repo}/contents/${path}?ref=main`);
    const body = {
      content: Buffer.from(content).toString('base64'),
      message,
      branch: 'main',
      author: { name: 'Dev Eloper', email: 'dev@example.test' },
      ...(existing.status === 200 ? { sha: existing.json.sha } : {}),
    };
    const res = await gitea(
      existing.status === 200 ? 'PUT' : 'POST',
      `/repos/${ADMIN.user}/${repo}/contents/${path}`,
      body,
    );

    expect(res.status).toBeLessThan(300);

    return res.json.commit.sha as string;
  };

  const deleteFile = async (repo: string, path: string, message: string) => {
    const existing = await gitea('GET', `/repos/${ADMIN.user}/${repo}/contents/${path}?ref=main`);
    const res = await gitea('DELETE', `/repos/${ADMIN.user}/${repo}/contents/${path}`, {
      sha: existing.json.sha,
      message,
      branch: 'main',
    });

    expect(res.status).toBeLessThan(300);

    return res.json.commit.sha as string;
  };

  const readFile = async (repo: string, path: string, ref = 'main'): Promise<string | null> => {
    const res = await gitea('GET', `/repos/${ADMIN.user}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`);

    return res.status === 200 ? Buffer.from(res.json.content, 'base64').toString('utf8') : null;
  };

  const waitFor = async <T>(
    what: string,
    fn: () => Promise<T | undefined | null | false>,
    timeoutMs = 60_000,
  ): Promise<T> => {
    const end = Date.now() + timeoutMs;

    for (;;) {
      const value = await fn();

      if (value) return value as T;

      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);

      await new Promise((r) => setTimeout(r, 500));
    }
  };

  const commitRow = (sha: string) =>
    waitFor(`commit ${sha.slice(0, 8)}`, async () =>
      (await api('GET', `/git/connections/${connectionId}/commits`)).json.find(
        (c: { sha: string; kind: string }) => c.sha === sha && c.kind === 'push',
      ),
    );

  const statusOf = (repo: string, sha: string, state: string) =>
    waitFor(`status ${state} on ${sha.slice(0, 8)}`, async () => {
      const res = await gitea('GET', `/repos/${ADMIN.user}/${repo}/commits/${sha}/statuses`);

      return (res.json as { context: string; status: string; description: string }[]).find(
        (s) => s.context === 'loadweaver/plan' && s.status === state,
      );
    });

  const applyPlan = async (id: string) => {
    const plan = (await api('GET', `/plans/${id}`)).json;

    if (plan.status === 'pending' && Object.keys(plan.creatorRoles).length > 0 && plan.createdBy === 'git')
      expect((await api('POST', `/plans/${id}/approve`)).status).toBeLessThan(300);

    const applied = await api('POST', `/plans/${id}/apply`, {});

    expect(applied.json.status).toBe('applied');
  };

  beforeAll(async () => {
    // A self-signed CA certificate for 127.0.0.1 from Gitea itself (no openssl needed on the host).
    const pems = docker([
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      GITEA_IMAGE,
      '-c',
      'cd /tmp && gitea cert --ca --host 127.0.0.1,localhost >/dev/null 2>&1 && cat cert.pem key.pem',
    ]);

    ca = `${/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(pems)?.[0]}\n`;
    writeFileSync(join(dir, 'cert.pem'), ca, { mode: 0o644 });
    writeFileSync(
      join(dir, 'key.pem'),
      `${/-----BEGIN RSA PRIVATE KEY-----[\s\S]+?-----END RSA PRIVATE KEY-----/.exec(pems)?.[0]}\n`,
      { mode: 0o644 },
    );

    docker([
      'create',
      '--name',
      container,
      '--memory',
      '512m',
      '-p',
      '127.0.0.1::3000',
      '-p',
      '127.0.0.1::2222',
      ...[
        'GITEA__security__INSTALL_LOCK=true',
        'GITEA__server__PROTOCOL=https',
        'GITEA__server__CERT_FILE=/tmp/gitea-cert.pem',
        'GITEA__server__KEY_FILE=/tmp/gitea-key.pem',
        'GITEA__server__ROOT_URL=https://127.0.0.1:3000/',
        'GITEA__server__START_SSH_SERVER=true',
        'GITEA__server__SSH_PORT=2222',
        'GITEA__server__SSH_LISTEN_PORT=2222',
        'GITEA__database__DB_TYPE=sqlite3',
        'GITEA__repository__DEFAULT_BRANCH=main',
        'GITEA__service__DISABLE_REGISTRATION=true',
      ].flatMap((e) => ['-e', e]),
      GITEA_IMAGE,
    ]);
    docker(['cp', join(dir, 'cert.pem'), `${container}:/tmp/gitea-cert.pem`]);
    docker(['cp', join(dir, 'key.pem'), `${container}:/tmp/gitea-key.pem`]);
    docker(['start', container]);

    const port = (p: string) => {
      const mapping = docker(['port', container, p]).split('\n')[0];

      return mapping.slice(mapping.lastIndexOf(':') + 1);
    };

    giteaUrl = `https://127.0.0.1:${port('3000/tcp')}`;
    sshPort = port('2222/tcp');

    await waitFor('gitea', async () => {
      try {
        return (await providerRequest({ caCertificate: ca }, 'GET', `${giteaUrl}/api/healthz`, {})).status === 200;
      } catch {
        return false;
      }
    });

    docker([
      'exec',
      container,
      'gitea',
      'admin',
      'user',
      'create',
      '--admin',
      '--username',
      ADMIN.user,
      '--password',
      ADMIN.password,
      '--email',
      ADMIN.email,
      '--must-change-password=false',
    ]);

    const created = await providerRequest(
      { caCertificate: ca },
      'POST',
      `${giteaUrl}/api/v1/users/${ADMIN.user}/tokens`,
      { authorization: `Basic ${Buffer.from(`${ADMIN.user}:${ADMIN.password}`).toString('base64')}` },
      { name: 'loadweaver', scopes: ['write:repository', 'write:user'] },
    );

    token = created.json.sha1;

    for (const name of ['shop', 'ops'])
      expect((await gitea('POST', '/user/repos', { name, auto_init: true, default_branch: 'main' })).status).toBe(201);

    app = await createApp();
    jest.spyOn(app.get(PlatformCredentialsService), 'providerConfig').mockImplementation(async (ref: string) => {
      const value = secrets.get(ref);

      if (value === undefined) throw new Error(`${ref} has no value yet`);

      return value.startsWith('{') ? (JSON.parse(value) as Record<string, string>) : { apiToken: value };
    });
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    // The project the connection belongs to, with one resource that exists before Git.
    const setup = await api('POST', '/plans', {
      documents: `apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: gitshop }\nspec: {}\n---\napiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: gitssh }\nspec: {}\n---\n${group('web', 'web')}`,
    });

    expect({ status: setup.status, body: setup.status === 201 ? null : setup.json }).toEqual({
      status: 201,
      body: null,
    });
    await applyPlan(setup.json.id);
  }, 240_000);

  afterAll(async () => {
    await app?.close();

    try {
      docker(['rm', '-f', container]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('connects a project to its repository (validation, project secrets only, webhook secret once)', async () => {
    secrets.set('secret://gitshop/gitea-token', JSON.stringify({ token }));

    const base = {
      project: 'gitshop',
      provider: 'gitea',
      repoUrl: `${giteaUrl}/${ADMIN.user}/shop.git`,
      branch: 'main',
      path: 'loadweaver',
      mode: 'bidirectional',
      credentials: 'secret://gitshop/gitea-token',
      caCertificate: ca,
      pollIntervalSeconds: 10,
    };

    for (const bad of [
      { repoUrl: 'file:///etc' },
      { repoUrl: `${giteaUrl.replace('https', 'http')}/x/y.git` },
      { branch: '--upload-pack=x' },
      { path: '../etc' },
      { credentials: 'secret://other/token' },
    ])
      expect((await api('POST', '/git/connections', { ...base, ...bad })).status).toBe(400);

    const created = await api('POST', '/git/connections', base);

    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ project: 'gitshop', mode: 'bidirectional', webhookPath: expect.any(String) });
    expect(created.json.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
    connectionId = created.json.id;

    expect((await api('GET', `/git/connections/${connectionId}`)).json.webhookSecret).toBeUndefined();
    expect((await api('GET', `/git/connections/${connectionId}/webhook-secret`)).json.webhookSecret).toBe(
      created.json.webhookSecret,
    );
    expect((await api('POST', '/git/connections', base)).status).toBe(409);

    const tested = await api('POST', `/git/connections/${connectionId}/test`);

    expect(tested.json).toMatchObject({
      ok: true,
      head: expect.stringMatching(/^[0-9a-f]{40}$/),
      defaultBranch: 'main',
    });
  });

  it('exports the project to the repository and refuses to overwrite a non-empty path without force', async () => {
    const exported = await api('POST', `/git/connections/${connectionId}/export`, {});

    expect(exported.json).toMatchObject({
      resources: 1,
      changed: true,
      commit: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
    expect(await readFile('shop', 'loadweaver/gitshop/workload-group-web.yaml')).toContain('name: web');
    expect((await api('POST', `/git/connections/${connectionId}/export`, {})).status).toBe(409);
    expect((await api('POST', `/git/connections/${connectionId}/export`, { force: true })).json).toMatchObject({
      changed: false,
    });
  });

  it('turns a push into a plan with its source, and the commit status follows the plan', async () => {
    const sha = await putFile('shop', 'loadweaver/gitshop/api.yaml', group('api', 'api'), 'add the api group');
    // Polling (10 s interval) picks the push up.
    const row = await commitRow(sha);

    expect(row).toMatchObject({
      state: 'pending',
      planId: expect.any(String),
      author: 'Dev Eloper <dev@example.test>',
    });

    const plan = (await api('GET', `/plans/${row.planId}`)).json;

    expect(plan.source).toEqual({
      kind: 'git',
      connection: connectionId,
      commit: sha,
      ref: 'refs/heads/main',
      author: 'Dev Eloper <dev@example.test>',
    });
    expect(plan.changes.filter((c: { action: string }) => c.action !== 'unchanged')).toEqual([
      expect.objectContaining({ action: 'create', kind: 'WorkloadGroup', name: 'api', project: 'gitshop' }),
    ]);
    await statusOf('shop', sha, 'pending');

    // Git authors count as developers: an operator / admin approves, then it applies.
    await applyPlan(row.planId);
    await statusOf('shop', sha, 'success');
    expect((await api('GET', '/resources/WorkloadGroup/api?project=gitshop')).status).toBe(200);
    expect((await api('GET', '/drift')).json.gitAhead).toEqual([]);
  });

  it('rejects pushes with plaintext secrets: no plan, a failed status naming file, line and rule, audit + drift', async () => {
    const sha = await putFile(
      'shop',
      'loadweaver/gitshop/leak.yaml',
      `${group('leak', 'leak')}  # ${FAKE_GITHUB_TOKEN}\n`,
      'oops',
    );
    const row = await waitFor('sync', async () => {
      const synced = await api('POST', `/git/connections/${connectionId}/sync`);

      return synced.json.commit === sha ? synced.json : undefined;
    });

    expect(row).toMatchObject({ state: 'rejected', planId: null });
    expect(row.reason).toContain('loadweaver/gitshop/leak.yaml:');
    expect(row.reason).toContain('(github-token)');
    expect(row.reason).not.toContain(FAKE_GITHUB_TOKEN);

    const status = await statusOf('shop', sha, 'failure');

    expect(status.description).toContain('leak.yaml');
    expect(status.description).not.toContain(FAKE_GITHUB_TOKEN);
    expect((await api('GET', '/drift')).json.gitAhead).toEqual([
      expect.objectContaining({ connection: connectionId, scope: 'gitshop', commit: sha, state: 'rejected' }),
    ]);

    const audit = await api('GET', '/audit?action=git.push-rejected');

    expect(JSON.stringify(audit.json)).toContain(sha);
    expect(JSON.stringify(audit.json)).not.toContain(FAKE_GITHUB_TOKEN);

    // Removing the file: the head matches the cluster again.
    const fixed = await deleteFile('shop', 'loadweaver/gitshop/leak.yaml', 'remove leak');

    expect((await api('POST', `/git/connections/${connectionId}/sync`)).json).toMatchObject({
      commit: fixed,
      state: 'no-changes',
    });
    expect((await api('GET', '/drift')).json.gitAhead).toEqual([]);
  });

  it('shows a plan that is not applied as "default branch ahead of cluster", with conflicts in the plan', async () => {
    // A change in the cluster that couldn't be committed back (the token is gone for a moment) ...
    const credentials = secrets.get('secret://gitshop/gitea-token') as string;

    secrets.delete('secret://gitshop/gitea-token');

    const ui = await api('POST', '/plans', { documents: group('api', 'api-ui') });

    expect(ui.status).toBe(201);
    await applyPlan(ui.json.id);
    await waitFor('failed commit-back', async () =>
      (await api('GET', `/git/connections/${connectionId}/commits`)).json.find(
        (c: { kind: string; planId: string; state: string }) =>
          c.kind === 'commit-back' && c.planId === ui.json.id && c.state === 'failed',
      ),
    );
    expect((await api('GET', `/git/connections/${connectionId}`)).json.lastError).toContain('commit-back');
    secrets.set('secret://gitshop/gitea-token', credentials);

    // ... and a push changing the same resource: the plan shows the conflict instead of silently overwriting.

    const sha = await putFile('shop', 'loadweaver/gitshop/api.yaml', group('api', 'api-git'), 'retarget api');
    const synced = await api('POST', `/git/connections/${connectionId}/sync`);

    expect(synced.json).toMatchObject({ commit: sha, state: 'pending' });

    const plan = (await api('GET', `/plans/${synced.json.planId}`)).json;

    expect(plan.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'git-conflict', kind: 'WorkloadGroup', name: 'api' })]),
    );
    expect((await api('GET', '/drift')).json.gitAhead).toEqual([
      expect.objectContaining({ commit: sha, planId: plan.id, state: 'pending' }),
    ]);

    await applyPlan(plan.id);
    await waitFor('ahead cleared', async () => (await api('GET', '/drift')).json.gitAhead.length === 0);
  });

  it('commits UI changes back in bidirectional mode (plan id and author in the message)', async () => {
    const ui = await api('POST', '/plans', { documents: group('web', 'web-v2') });

    expect(ui.json.source).toMatchObject({ kind: 'api' });
    await applyPlan(ui.json.id);

    const content = await waitFor('commit-back', async () => {
      const text = await readFile('shop', 'loadweaver/gitshop/workload-group-web.yaml');

      return text?.includes('web-v2') ? text : undefined;
    });

    expect(content).toContain('name: web');

    const commits = await gitea('GET', `/repos/${ADMIN.user}/shop/commits?sha=main&limit=1`);

    expect(commits.json[0].commit.message).toContain(`Loadweaver plan ${ui.json.id} by api-key`);

    // The commit-back is in sync: the next poll plans nothing.
    expect((await api('POST', `/git/connections/${connectionId}/sync`)).json.state).toMatch(/no-changes|unchanged/);
  });

  it('accepts signed webhook deliveries and refuses wrong signatures', async () => {
    const secret = (await api('GET', `/git/connections/${connectionId}/webhook-secret`)).json.webhookSecret;
    const body = JSON.stringify({ ref: 'refs/heads/main', repository: { full_name: `${ADMIN.user}/shop` } });
    const sign = (key: string, text = body) => `sha256=${createHmac('sha256', key).update(text).digest('hex')}`;
    const deliver = (signature: string, event = 'push', extra: Record<string, string> = {}, text = body) =>
      fetch(`${baseUrl}/api/git/webhooks/${connectionId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-gitea-event': event,
          'x-hub-signature-256': signature,
          ...extra,
        },
        body: text,
      });
    const good = sign(secret);

    const accepted = await deliver(good);

    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({ status: 'queued', event: 'push' });
    expect((await deliver(good, 'pull_request')).status).toBe(202);
    expect((await deliver(`sha256=${'0'.repeat(64)}`)).status).toBe(401);

    // A delivery is handled once (replay protection, H1).
    expect(await (await deliver(good, 'push', { 'x-gitea-delivery': 'd-42' })).json()).toEqual({
      status: 'queued',
      event: 'push',
    });
    expect(await (await deliver(good, 'push', { 'x-gitea-delivery': 'd-42' })).json()).toEqual({
      status: 'ignored',
      event: 'push',
    });

    // Signed, but about another repository (L4).
    const foreign = JSON.stringify({ ref: 'refs/heads/main', repository: { full_name: `${ADMIN.user}/other` } });

    expect(await (await deliver(sign(secret, foreign), 'push', {}, foreign)).json()).toEqual({
      status: 'ignored',
      event: 'push',
    });

    // Rotating the secret revokes the old one at once (audited); the new one works.
    const rotated = await api('POST', `/git/connections/${connectionId}/webhook-secret/rotate`);

    expect(rotated.json).toMatchObject({
      webhookSecret: expect.stringMatching(/^[0-9a-f]{64}$/),
      webhookGeneration: 1,
    });
    expect(rotated.json.webhookSecret).not.toBe(secret);
    expect((await deliver(good)).status).toBe(401);
    expect((await deliver(sign(rotated.json.webhookSecret))).status).toBe(202);
    expect((await api('GET', `/git/connections/${connectionId}/webhook-secret`)).json.webhookSecret).toBe(
      rotated.json.webhookSecret,
    );
    expect((await api('GET', `/git/connections/${connectionId}`)).json.webhookGeneration).toBe(1);
    expect(
      (
        await fetch(`${baseUrl}/api/git/webhooks/00000000-0000-4000-8000-000000000000`, {
          method: 'POST',
          headers: { 'x-gitea-event': 'push', 'x-hub-signature-256': good },
          body,
        })
      ).status,
    ).toBe(401);
  });

  it('opens a pull request for UI changes in authoritative mode; the plan cannot be applied directly', async () => {
    expect((await api('PATCH', `/git/connections/${connectionId}`, { mode: 'authoritative' })).json.mode).toBe(
      'authoritative',
    );

    const ui = await api('POST', '/plans', { documents: group('web', 'web-v3') });

    // The pull request is opened in the background (M5); the plan says so until the link is there.
    expect(ui.json.source.pullRequests[0]).toMatchObject({ connection: connectionId, pending: true });
    await app.get(GitSyncService).pullRequestsOpened();

    const pr = (await api('GET', `/plans/${ui.json.id}`)).json.source.pullRequests[0];

    expect(pr).toMatchObject({
      connection: connectionId,
      branch: `loadweaver/plan-${ui.json.id}`,
      url: expect.stringContaining('/pulls/'),
      number: expect.any(Number),
    });

    const blocked = await api('POST', `/plans/${ui.json.id}/apply`, {});

    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.json.blockers)).toContain('managed in Git (authoritative)');

    const pulls = await gitea('GET', `/repos/${ADMIN.user}/shop/pulls?state=open`);

    expect(pulls.json.map((p: { head: { ref: string } }) => p.head.ref)).toContain(pr.branch);
    expect(await readFile('shop', 'loadweaver/gitshop/workload-group-web.yaml', pr.branch)).toContain('web-v3');
    expect(await readFile('shop', 'loadweaver/gitshop/workload-group-web.yaml')).not.toContain('web-v3');
  });

  it('imports memberships from access.yaml on sync and commits direct API changes back', async () => {
    expect(
      (await api('PATCH', `/git/connections/${connectionId}`, { membershipsFromGit: true })).json.membershipsFromGit,
    ).toBe(true);

    // Only the connection's own project may be listed.
    const foreign = await putFile(
      'shop',
      'loadweaver/access.yaml',
      'projects:\n  - name: gitssh\n    members: []\n',
      'access for another project',
    );
    const refused = await api('POST', `/git/connections/${connectionId}/sync`);

    expect(refused.json).toMatchObject({ commit: foreign, state: 'failed' });
    expect(refused.json.reason).toContain('outside this connection');

    const sha = await putFile(
      'shop',
      'loadweaver/access.yaml',
      'projects:\n  - name: gitshop\n    approvalMode: developers\n    members:\n      - { userId: dev-1, role: developer }\n',
      'grant dev-1',
    );

    expect((await api('POST', `/git/connections/${connectionId}/sync`)).json).toMatchObject({ commit: sha });
    expect((await api('GET', '/projects/gitshop/members')).json).toEqual([
      expect.objectContaining({ userId: 'dev-1', role: 'developer' }),
    ]);

    expect((await api('PUT', '/projects/gitshop/members/ops-1', { role: 'operator' })).status).toBeLessThan(300);

    const committed = await waitFor('access commit-back', async () => {
      const text = await readFile('shop', 'loadweaver/access.yaml');

      return text?.includes('ops-1') ? text : undefined;
    });

    expect(committed).toContain('dev-1');
    expect(committed).toContain('role: operator');
  });

  it('uses SSH with a deploy key and pins the host key on first contact; a changed key stops the connection', async () => {
    const keys = sshKeyPair();

    expect(
      (
        await gitea('POST', `/repos/${ADMIN.user}/ops/keys`, {
          title: 'loadweaver',
          key: keys.publicKey,
          read_only: false,
        })
      ).status,
    ).toBe(201);
    secrets.set('secret://gitssh/deploy-key', keys.privateKey);

    const created = await api('POST', '/git/connections', {
      project: 'gitssh',
      provider: 'git',
      repoUrl: `ssh://git@127.0.0.1:${sshPort}/${ADMIN.user}/ops.git`,
      branch: 'main',
      mode: 'bidirectional',
      credentials: 'secret://gitssh/deploy-key',
      webhook: false,
      pollIntervalSeconds: 3600,
    });

    expect(created.status).toBe(201);

    const id = created.json.id;
    const tested = await api('POST', `/git/connections/${id}/test`);

    expect(tested.json).toMatchObject({ ok: true, head: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(tested.json.hostKey).toContain(`[127.0.0.1]:${sshPort}`);
    expect((await api('GET', `/git/connections/${id}`)).json.hostKey).toBe(tested.json.hostKey);

    // Export writes over SSH (plain Git: no API, no status).
    const resource = await api('POST', '/plans', { documents: group('ops', 'ops', 'gitssh') });

    await applyPlan(resource.json.id);
    expect((await api('POST', `/git/connections/${id}/export`, {})).json).toMatchObject({
      changed: true,
      resources: 1,
    });
    expect(await readFile('ops', 'gitssh/workload-group-ops.yaml')).toContain('name: ops');

    // A different pinned key (e.g. a MITM or a rebuilt server) stops it until an admin resets the key.
    const other = 'ecdsa-sha2-nistp256 ' + sshKeyPair().publicKey.split(' ')[1];

    await app
      .get(DataSource)
      .getRepository(GitConnectionEntity)
      .update({ id }, { hostKey: `[127.0.0.1]:${sshPort} ${other}` });

    const refused = await api('POST', `/git/connections/${id}/test`);

    expect(refused.json.ok).toBe(false);
    expect(refused.json.error).toMatch(/host key|Host key/);

    const reset = await api('POST', `/git/connections/${id}/host-key/reset`);

    expect(reset.json.hostKey).toBeNull();
    expect((await api('POST', `/git/connections/${id}/test`)).json.ok).toBe(true);
    expect((await api('DELETE', `/git/connections/${id}`)).status).toBe(204);
  });

  it('decrypts SOPS files with the cluster age identity (files made by the real sops), and names failures', async () => {
    buildSopsLab();

    // The lab has no members holding the master key; a fixed one stands in for the unsealed key.
    const masterKey = jest
      .spyOn(app.get(MasterKeyService), 'current')
      .mockResolvedValue({ id: 'lab-master-key', value: randomBytes(32) });

    try {
      // Without SOPS on the connection, an encrypted file fails the sync with that reason.
      const recipient = (await api('GET', '/git/sops/recipient')).json.recipient as string;

      expect(recipient).toMatch(/^age1[0-9a-z]{58}$/);

      const encrypted = sopsEncrypt(group('vault', 'vault'), recipient);

      expect(encrypted).toContain('ENC[AES256_GCM,');
      expect(encrypted).not.toContain('app: vault');

      const sha = await putFile('shop', 'loadweaver/gitshop/vault.sops.yaml', encrypted, 'add an encrypted group');

      expect((await api('POST', `/git/connections/${connectionId}/sync`)).json).toMatchObject({
        commit: sha,
        state: 'failed',
        reason: 'loadweaver/gitshop/vault.sops.yaml is SOPS-encrypted, but SOPS is not enabled on this connection',
      });

      expect((await api('PATCH', `/git/connections/${connectionId}`, { sops: true })).json).toMatchObject({
        sops: true,
        sopsRecipient: recipient,
      });

      const synced = await api('POST', `/git/connections/${connectionId}/sync`);

      expect(synced.json).toMatchObject({ commit: sha, state: 'pending', planId: expect.any(String) });

      // Applied, the resource is known to come from a SOPS file: an export keeps the encrypted file and never
      // writes the resource in clear (M4).
      await applyPlan(synced.json.planId);

      const exported = await api('POST', `/git/connections/${connectionId}/export`, { force: true });

      expect(exported.status).toBe(200);
      expect(exported.json.skipped).toEqual(['WorkloadGroup/gitshop/vault']);
      expect(await readFile('shop', 'loadweaver/gitshop/vault.sops.yaml')).toBe(encrypted);
      expect(await readFile('shop', 'loadweaver/gitshop/workload-group-vault.yaml')).toBeNull();
      expect((await api('GET', `/plans/${synced.json.planId}`)).json.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'create',
            kind: 'WorkloadGroup',
            name: 'vault',
            after: expect.objectContaining({
              spec: expect.objectContaining({ selector: { matchLabels: { app: 'vault' } } }),
            }),
          }),
        ]),
      );

      // Encrypted to someone else: the sync fails naming the file, never a value.
      const other = await putFile(
        'shop',
        'loadweaver/gitshop/vault.sops.yaml',
        sopsEncrypt(group('vault', 'vault-2'), generateAgeIdentity().recipient),
        'encrypted for another key',
      );
      const refused = (await api('POST', `/git/connections/${connectionId}/sync`)).json;

      expect(refused).toMatchObject({ commit: other, state: 'failed' });
      expect(refused.reason).toMatch(/^loadweaver\/gitshop\/vault\.sops\.yaml: sops: /);
      expect(refused.reason).not.toContain('vault-2');

      // A sealed master key: the reason says so.
      masterKey.mockRejectedValue(new Error('no master key'));
      expect((await api('POST', `/git/connections/${connectionId}/sync`)).json.reason).toContain(
        'the cluster master key is not available (no master key)',
      );

      await deleteFile('shop', 'loadweaver/gitshop/vault.sops.yaml', 'remove the encrypted group');
      expect((await api('POST', `/git/connections/${connectionId}/sync`)).json.state).not.toBe('error');
    } finally {
      masterKey.mockRestore();
    }
  });

  it('audits every Git action', async () => {
    const audit = JSON.stringify((await api('GET', '/audit?action=git.*&limit=500')).json);

    for (const action of [
      'git.connection.create',
      'git.connection.update',
      'git.connection.delete',
      'git.connection.webhook-secret',
      'git.connection.webhook-secret-rotated',
      'git.connection.host-key-pinned',
      'git.connection.host-key-reset',
      'git.export',
      'git.sync',
      'git.push-rejected',
      'git.commit-back',
      'git.pr-opened',
      'git.sops.identity-created',
    ])
      expect(audit).toContain(action);

    expect(audit).not.toContain(token);
  });
});
