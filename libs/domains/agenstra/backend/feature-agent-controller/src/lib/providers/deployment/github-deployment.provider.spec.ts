import { createPublicKey, createVerify, generateKeyPairSync } from 'crypto';

import { BadRequestException } from '@nestjs/common';

import type { DeploymentProviderConnection } from './deployment-provider.interface';
import {
  GitHubDeploymentProvider,
  createGitHubAppJwt,
  mapGitHubConclusion,
  mapGitHubStatus,
} from './github-deployment.provider';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

function tokenConnection(overrides: Partial<DeploymentProviderConnection> = {}): DeploymentProviderConnection {
  return {
    id: 'conn-1',
    provider: 'github',
    baseUrl: null,
    authType: 'token',
    appId: null,
    installationId: null,
    username: null,
    secrets: { token: 'ghp_secrettokenvalue123' },
    ...overrides,
  };
}

function appConnection(): DeploymentProviderConnection {
  return tokenConnection({
    authType: 'app',
    appId: '123',
    installationId: '456',
    secrets: { privateKey: privateKeyPem },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const run = {
  id: 99,
  name: 'Deploy',
  display_title: 'Deploy prod',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'main',
  head_sha: 'abc',
  html_url: 'https://github.com/o/r/actions/runs/99',
  created_at: new Date(Date.now()).toISOString(),
  updated_at: new Date(Date.now() + 60_000).toISOString(),
  run_started_at: new Date(Date.now()).toISOString(),
};

describe('GitHubDeploymentProvider', () => {
  let provider: GitHubDeploymentProvider;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    provider = new GitHubDeploymentProvider();
    provider.dispatchResolveDelayMs = 0;
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  const urlOf = (i: number): string => String(fetchMock.mock.calls[i][0]);
  const initOf = (i: number): RequestInit => fetchMock.mock.calls[i][1] as RequestInit;

  it('maps statuses and conclusions', () => {
    expect(mapGitHubStatus('queued')).toBe('queued');
    expect(mapGitHubStatus('waiting')).toBe('queued');
    expect(mapGitHubStatus('in_progress')).toBe('in_progress');
    expect(mapGitHubStatus('completed')).toBe('completed');
    expect(mapGitHubConclusion('timed_out')).toBe('timed_out');
    expect(mapGitHubConclusion('action_required')).toBe('failure');
    expect(mapGitHubConclusion(null)).toBeNull();
  });

  it('signs a verifiable RS256 app JWT', () => {
    const jwt = createGitHubAppJwt('123', privateKeyPem, 1_700_000_000_000);
    const [h, p, s] = jwt.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString()) as { iss: string; exp: number; iat: number };
    const verifier = createVerify('RSA-SHA256');

    verifier.update(`${h}.${p}`);
    expect(
      verifier.verify(createPublicKey(publicKey.export({ type: 'spki', format: 'pem' })), Buffer.from(s, 'base64url')),
    ).toBe(true);
    expect(payload.iss).toBe('123');
    expect(payload.exp - payload.iat).toBe(600);
    expect(() => createGitHubAppJwt('1', 'not a key')).toThrow(BadRequestException);
  });

  it('tests token connections against /user', async () => {
    fetchMock.mockResolvedValueOnce(json({ login: 'octo' }));

    await expect(provider.testConnection(tokenConnection())).resolves.toEqual({
      ok: true,
      message: 'Authenticated as octo',
    });
    expect(urlOf(0)).toBe('https://api.github.com/user');
    expect((initOf(0).headers as Record<string, string>)['Authorization']).toBe('Bearer ghp_secrettokenvalue123');
  });

  it('reports failed tests without leaking the token', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: 'Bad credentials ghp_secrettokenvalue123' }, 401));

    const res = await provider.testConnection(tokenConnection());

    expect(res.ok).toBe(false);
    expect(res.message).not.toContain('ghp_secrettokenvalue123');
  });

  it('mints and caches installation tokens for app connections', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ token: 'ghs_installation', expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201),
      )
      .mockResolvedValueOnce(json({ total_count: 2, repositories: [] }))
      .mockResolvedValueOnce(json({ total_count: 2, repositories: [] }));

    const conn = appConnection();

    await expect(provider.testConnection(conn)).resolves.toMatchObject({ ok: true });
    await provider.testConnection(conn);

    expect(urlOf(0)).toBe('https://api.github.com/app/installations/456/access_tokens');
    expect(initOf(0).method).toBe('POST');
    expect((initOf(1).headers as Record<string, string>)['Authorization']).toBe('Bearer ghs_installation');
    // Cached: no second mint.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('lists and filters repositories', async () => {
    fetchMock.mockResolvedValueOnce(
      json([
        { id: 1, name: 'api', full_name: 'o/api', default_branch: 'main', html_url: 'u', private: true },
        { id: 2, name: 'web', full_name: 'o/web', default_branch: 'main', html_url: 'u', private: false },
      ]),
    );

    await expect(provider.listRepositories(tokenConnection(), 'API')).resolves.toEqual([
      { id: 'o/api', name: 'api', fullName: 'o/api', defaultBranch: 'main', url: 'u', private: true },
    ]);
    expect(urlOf(0)).toContain('/user/repos?per_page=100&page=1');
  });

  it('rejects malformed repositories', async () => {
    await expect(provider.listBranches(tokenConnection(), '../x')).rejects.toBeInstanceOf(BadRequestException);
    await expect(provider.listBranches(tokenConnection(), 'a/b/c')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists branches with the default flag', async () => {
    fetchMock.mockResolvedValueOnce(json({ default_branch: 'main' })).mockResolvedValueOnce(
      json([
        { name: 'main', commit: { sha: 's1' } },
        { name: 'dev', commit: { sha: 's2' } },
      ]),
    );

    await expect(
      provider.listBranches(tokenConnection({ baseUrl: 'https://ghe.local/api/v3' }), 'o/r'),
    ).resolves.toEqual([
      { name: 'main', sha: 's1', default: true },
      { name: 'dev', sha: 's2', default: false },
    ]);
    expect(urlOf(0)).toBe('https://ghe.local/api/v3/repos/o/r');
  });

  it('uses returned run details on github.com dispatch', async () => {
    fetchMock.mockResolvedValueOnce(json({ workflow_run_id: 99, html_url: 'x' })).mockResolvedValueOnce(json(run));

    const snap = await provider.trigger(tokenConnection(), {
      repository: 'o/r',
      workflow: 'deploy.yml',
      ref: 'main',
      inputs: { env: 'prod' },
    });

    expect(urlOf(0)).toBe('https://api.github.com/repos/o/r/actions/workflows/deploy.yml/dispatches');
    expect(JSON.parse(String(initOf(0).body))).toEqual({
      ref: 'main',
      inputs: { env: 'prod' },
      return_run_details: true,
    });
    expect(snap).toMatchObject({
      providerRunId: '99',
      status: 'completed',
      conclusion: 'success',
      name: 'Deploy prod',
    });
  });

  it('resolves the dispatched run by listing (GHES 204)', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ workflow_runs: [] }))
      .mockResolvedValueOnce(json({ workflow_runs: [{ ...run, status: 'queued', conclusion: null }] }));

    const snap = await provider.trigger(tokenConnection({ baseUrl: 'https://ghe.local/api/v3' }), {
      repository: 'o/r',
      workflow: '42',
      ref: 'release/1',
      inputs: {},
    });

    expect(JSON.parse(String(initOf(0).body))).toEqual({ ref: 'release/1', inputs: {} });
    expect(urlOf(1)).toContain('/actions/workflows/42/runs?event=workflow_dispatch&branch=release%2F1');
    expect(snap).toMatchObject({ providerRunId: '99', status: 'queued', conclusion: null });
  });

  it('returns a queued snapshot without run id when the run is not listed yet', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValue(json({ workflow_runs: [] }));

    const snap = await provider.trigger(tokenConnection({ baseUrl: 'https://ghe.local/api/v3' }), {
      repository: 'o/r',
      workflow: 'deploy.yml',
      ref: 'main',
      inputs: {},
    });

    expect(snap).toMatchObject({ providerRunId: null, status: 'queued', ref: 'main' });
    expect(fetchMock).toHaveBeenCalledTimes(1 + provider.dispatchResolveAttempts);
  });

  it('requires a workflow on trigger', async () => {
    await expect(
      provider.trigger(tokenConnection(), { repository: 'o/r', workflow: null, ref: 'main', inputs: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps a 422 dispatch error to BadRequest', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "Workflow does not have 'workflow_dispatch' trigger" }, 422));

    await expect(
      provider.trigger(tokenConnection(), { repository: 'o/r', workflow: 'x.yml', ref: 'main', inputs: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists runs and jobs, rejects invalid run ids', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ workflow_runs: [run] }))
      .mockResolvedValueOnce(
        json({ jobs: [{ id: 5, name: 'build', status: 'in_progress', conclusion: null, started_at: run.created_at }] }),
      );

    const runs = await provider.listRuns(tokenConnection(), { repository: 'o/r', workflow: 'deploy.yml', limit: 5 });

    expect(urlOf(0)).toContain('/actions/workflows/deploy.yml/runs?per_page=5');
    expect(runs[0].completedAt).toBeInstanceOf(Date);

    const jobs = await provider.listJobs(tokenConnection(), 'o/r', '99');

    expect(jobs).toEqual([
      expect.objectContaining({ id: '5', name: 'build', status: 'in_progress', conclusion: null }),
    ]);
    await expect(provider.getRun(tokenConnection(), 'o/r', '../1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('concatenates job logs (tail) and treats missing logs as empty', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          jobs: [
            { id: 1, name: 'a', status: 'completed' },
            { id: 2, name: 'b', status: 'completed' },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response('log-a', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));

    await expect(provider.getRunLogs(tokenConnection(), 'o/r', '99', 1000)).resolves.toEqual({
      logs: '===== a =====\nlog-a\n\n===== b =====\n',
      truncated: false,
    });
  });

  it('cancels runs', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));

    await provider.cancelRun(tokenConnection(), 'o/r', '99');
    expect(urlOf(0)).toBe('https://api.github.com/repos/o/r/actions/runs/99/cancel');
    expect(initOf(0).method).toBe('POST');
  });
});
