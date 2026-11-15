import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { DeploymentProviderConnection } from './deployment-provider.interface';
import { GitLabDeploymentProvider, mapGitLabStatus } from './gitlab-deployment.provider';

const conn = (overrides: Partial<DeploymentProviderConnection> = {}): DeploymentProviderConnection => ({
  id: 'c1',
  provider: 'gitlab',
  baseUrl: null,
  authType: 'token',
  appId: null,
  installationId: null,
  username: null,
  secrets: { token: 'glpat-secretsecretsecret' },
  ...overrides,
});
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const pipeline = {
  id: 77,
  iid: 7,
  status: 'running',
  ref: 'main',
  sha: 'abc',
  web_url: 'https://gitlab.com/g/p/-/pipelines/77',
  started_at: '2026-01-01T00:00:00Z',
  finished_at: null,
};

describe('GitLabDeploymentProvider', () => {
  let provider: GitLabDeploymentProvider;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    provider = new GitLabDeploymentProvider();
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  const urlOf = (i: number): string => String(fetchMock.mock.calls[i][0]);
  const initOf = (i: number): RequestInit => fetchMock.mock.calls[i][1] as RequestInit;

  it('maps pipeline statuses', () => {
    expect(mapGitLabStatus('pending')).toEqual({ status: 'queued', conclusion: null });
    expect(mapGitLabStatus('running')).toEqual({ status: 'in_progress', conclusion: null });
    expect(mapGitLabStatus('success')).toEqual({ status: 'completed', conclusion: 'success' });
    expect(mapGitLabStatus('failed')).toEqual({ status: 'completed', conclusion: 'failure' });
    expect(mapGitLabStatus('canceled')).toEqual({ status: 'completed', conclusion: 'cancelled' });
    expect(mapGitLabStatus('skipped')).toEqual({ status: 'completed', conclusion: 'skipped' });
  });

  it('tests the connection with PRIVATE-TOKEN on /api/v4/user', async () => {
    fetchMock.mockResolvedValueOnce(json({ username: 'bot' }));

    await expect(provider.testConnection(conn({ baseUrl: 'https://git.example.com' }))).resolves.toEqual({
      ok: true,
      message: 'Authenticated as bot',
    });
    expect(urlOf(0)).toBe('https://git.example.com/api/v4/user');
    expect((initOf(0).headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('glpat-secretsecretsecret');
  });

  it('does not double the api suffix', async () => {
    fetchMock.mockResolvedValueOnce(json({ username: 'bot' }));
    await provider.testConnection(conn({ baseUrl: 'https://git.example.com/api/v4' }));
    expect(urlOf(0)).toBe('https://git.example.com/api/v4/user');
  });

  it('lists projects as repositories', async () => {
    fetchMock.mockResolvedValueOnce(
      json([
        { id: 5, name: 'p', path_with_namespace: 'g/p', default_branch: 'main', web_url: 'w', visibility: 'public' },
      ]),
    );

    await expect(provider.listRepositories(conn(), 'p')).resolves.toEqual([
      { id: '5', name: 'p', fullName: 'g/p', defaultBranch: 'main', url: 'w', private: false },
    ]);
    expect(urlOf(0)).toContain('/projects?membership=true');
    expect(urlOf(0)).toContain('search=p');
  });

  it('URL-encodes project paths and validates them', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ default_branch: 'main' }))
      .mockResolvedValueOnce(json([{ name: 'main', commit: { id: 's' } }]));

    await expect(provider.listBranches(conn(), 'group/sub/proj')).resolves.toEqual([
      { name: 'main', sha: 's', default: true },
    ]);
    expect(urlOf(0)).toBe('https://gitlab.com/api/v4/projects/group%2Fsub%2Fproj');
    await expect(provider.listBranches(conn(), '../etc')).rejects.toBeInstanceOf(BadRequestException);
    await expect(provider.listBranches(conn(), 'single')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns no provider workflows', async () => {
    await expect(provider.listWorkflows()).resolves.toEqual([]);
  });

  it('creates a pipeline with variables', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...pipeline, status: 'created' }, 201));

    const snap = await provider.trigger(conn(), {
      repository: '5',
      workflow: null,
      ref: 'main',
      inputs: { ENV: 'prod' },
    });

    expect(urlOf(0)).toBe('https://gitlab.com/api/v4/projects/5/pipeline');
    expect(JSON.parse(String(initOf(0).body))).toEqual({
      ref: 'main',
      variables: [{ key: 'ENV', value: 'prod', variable_type: 'env_var' }],
    });
    expect(snap).toMatchObject({ providerRunId: '77', status: 'queued', name: 'Pipeline #7' });
  });

  it('gets and lists pipelines', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ ...pipeline, status: 'success', finished_at: '2026-01-01T00:05:00Z' }))
      .mockResolvedValueOnce(json([pipeline]));

    const run = await provider.getRun(conn(), '5', '77');

    expect(run).toMatchObject({ status: 'completed', conclusion: 'success' });
    expect(run.completedAt?.toISOString()).toBe('2026-01-01T00:05:00.000Z');

    await provider.listRuns(conn(), { repository: '5', workflow: null, limit: 500 });
    expect(urlOf(1)).toContain('/pipelines?per_page=100&order_by=id&sort=desc');
    await expect(provider.getRun(conn(), '5', 'abc')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists jobs and reads traces (tail)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json([
          { id: 2, name: 'deploy', stage: 'deploy', status: 'failed' },
          { id: 1, name: 'build', stage: 'build', status: 'success' },
        ]),
      )
      .mockResolvedValueOnce(new Response('0123456789', { status: 200 }));

    const jobs = await provider.listJobs(conn(), '5', '77');

    expect(jobs.map((j) => j.id)).toEqual(['1', '2']);
    expect(jobs[1]).toMatchObject({ name: 'deploy: deploy', conclusion: 'failure' });
    await expect(provider.getJobLogs(conn(), '5', '77', '2', 4)).resolves.toEqual({ logs: '6789', truncated: true });
    expect(urlOf(1)).toBe('https://gitlab.com/api/v4/projects/5/jobs/2/trace');
  });

  it('maps provider errors and cancels pipelines', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ message: '404 Project Not Found' }, 404))
      .mockResolvedValueOnce(json(pipeline));

    await expect(provider.getRun(conn(), '5', '1')).rejects.toBeInstanceOf(NotFoundException);
    await provider.cancelRun(conn(), '5', '77');
    expect(urlOf(1)).toBe('https://gitlab.com/api/v4/projects/5/pipelines/77/cancel');
    expect(initOf(1).method).toBe('POST');
  });
});
