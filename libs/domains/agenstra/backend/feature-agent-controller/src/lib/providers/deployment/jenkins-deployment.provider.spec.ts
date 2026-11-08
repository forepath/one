import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { DeploymentProviderConnection } from './deployment-provider.interface';
import {
  JENKINS_CONSOLE_JOB_ID,
  JenkinsDeploymentProvider,
  mapJenkinsBuildStatus,
} from './jenkins-deployment.provider';

const conn = (overrides: Partial<DeploymentProviderConnection> = {}): DeploymentProviderConnection => ({
  id: 'c1',
  provider: 'jenkins',
  baseUrl: 'https://ci.example.com',
  authType: 'token',
  appId: null,
  installationId: null,
  username: 'deployer',
  secrets: { token: 'jenkins-api-token-secret' },
  ...overrides,
});

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

describe('JenkinsDeploymentProvider', () => {
  let provider: JenkinsDeploymentProvider;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    provider = new JenkinsDeploymentProvider();
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  const urlOf = (i: number): string => String(fetchMock.mock.calls[i][0]);
  const initOf = (i: number): RequestInit => fetchMock.mock.calls[i][1] as RequestInit;

  it('maps build statuses', () => {
    expect(mapJenkinsBuildStatus({ building: true, result: null })).toEqual({
      status: 'in_progress',
      conclusion: null,
    });
    expect(mapJenkinsBuildStatus({ building: false, result: 'SUCCESS' })).toEqual({
      status: 'completed',
      conclusion: 'success',
    });
    expect(mapJenkinsBuildStatus({ building: false, result: 'FAILURE' }).conclusion).toBe('failure');
    expect(mapJenkinsBuildStatus({ building: false, result: 'UNSTABLE' }).conclusion).toBe('failure');
    expect(mapJenkinsBuildStatus({ building: false, result: 'ABORTED' }).conclusion).toBe('cancelled');
    expect(mapJenkinsBuildStatus({ building: false, result: 'NOT_BUILT' }).conclusion).toBe('skipped');
  });

  it('uses basic auth and requires base URL / credentials', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 'deployer', fullName: 'Deployer' }));

    await expect(provider.testConnection(conn())).resolves.toEqual({ ok: true, message: 'Authenticated as Deployer' });
    expect((initOf(0).headers as Record<string, string>)['Authorization']).toBe(
      `Basic ${Buffer.from('deployer:jenkins-api-token-secret').toString('base64')}`,
    );
    await expect(provider.testConnection(conn({ baseUrl: null }))).resolves.toMatchObject({ ok: false });
    await expect(provider.listBranches(conn({ username: null }), 'a')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists jobs recursively through folders, keeping multibranch projects', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        jobs: [
          { _class: 'hudson.model.FreeStyleProject', name: 'deploy', fullName: 'deploy', url: 'u1' },
          {
            _class: 'com.cloudbees.hudson.plugins.folder.Folder',
            name: 'team',
            fullName: 'team',
            jobs: [
              {
                _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob',
                name: 'api',
                fullName: 'team/api',
                url: 'u2',
              },
              {
                _class: 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject',
                name: 'web',
                fullName: 'team/web',
                url: 'u3',
                jobs: [{ name: 'main' }],
              },
            ],
          },
        ],
      }),
    );

    const repos = await provider.listRepositories(conn());

    expect(repos.map((r) => r.id)).toEqual(['deploy', 'team/api', 'team/web']);
    expect(urlOf(0)).toContain('https://ci.example.com/api/json?tree=');
  });

  it('returns branches only for multibranch projects', async () => {
    fetchMock.mockResolvedValueOnce(json({ _class: 'hudson.model.FreeStyleProject' })).mockResolvedValueOnce(
      json({
        _class: 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject',
        jobs: [{ name: 'main' }, { name: 'feature%2Fx' }],
      }),
    );

    await expect(provider.listBranches(conn(), 'deploy')).resolves.toEqual([]);
    await expect(provider.listBranches(conn(), 'team/web')).resolves.toEqual([
      { name: 'main', sha: null, default: true },
      { name: 'feature/x', sha: null, default: false },
    ]);
    expect(urlOf(1)).toContain('https://ci.example.com/job/team/job/web/api/json');
  });

  it('triggers parameterized jobs with buildWithParameters and returns a queue id', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ _class: 'hudson.model.FreeStyleProject', property: [{ parameterDefinitions: [{ name: 'ENV' }] }] }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 201, headers: { location: 'https://ci.example.com/queue/item/42/' } }),
      );

    const snap = await provider.trigger(conn(), {
      repository: 'team/api',
      workflow: null,
      ref: 'main',
      inputs: { ENV: 'prod' },
    });

    expect(urlOf(1)).toBe('https://ci.example.com/job/team/job/api/buildWithParameters');
    expect(initOf(1).body).toBe('ENV=prod');
    expect(snap).toMatchObject({ providerRunId: 'queue:42', status: 'queued' });
  });

  it('triggers plain jobs with build and rejects inputs for them', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ _class: 'hudson.model.FreeStyleProject', property: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 201, headers: { location: '/queue/item/7/' } }))
      .mockResolvedValueOnce(json({ _class: 'hudson.model.FreeStyleProject', property: [] }));

    await expect(
      provider.trigger(conn(), { repository: 'deploy', workflow: null, ref: '', inputs: {} }),
    ).resolves.toMatchObject({
      providerRunId: 'queue:7',
    });
    expect(urlOf(1)).toBe('https://ci.example.com/job/deploy/build');
    await expect(
      provider.trigger(conn(), { repository: 'deploy', workflow: null, ref: '', inputs: { A: '1' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('triggers the branch job of multibranch projects', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ _class: 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject' }))
      .mockResolvedValueOnce(json({ property: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 201, headers: { location: '/queue/item/8/' } }));

    await provider.trigger(conn(), { repository: 'team/web', workflow: null, ref: 'feature/x', inputs: {} });
    expect(urlOf(2)).toBe('https://ci.example.com/job/team/job/web/job/feature%252Fx/build');
  });

  it('resolves queue items to builds', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ id: 42, task: { url: 'https://ci.example.com/job/team/job/api/' }, executable: { number: 12 } }),
      )
      .mockResolvedValueOnce(
        json({
          number: 12,
          url: 'https://ci.example.com/job/team/job/api/12/',
          building: true,
          timestamp: 1_700_000_000_000,
        }),
      )
      .mockResolvedValueOnce(json({ id: 43, why: 'Waiting' }))
      .mockResolvedValueOnce(
        json({
          id: 44,
          task: { url: 'https://ci.example.com/job/team/job/web/job/feature%252Fx/' },
          executable: { number: 3 },
        }),
      )
      .mockResolvedValueOnce(
        json({ number: 3, building: false, result: 'SUCCESS', timestamp: 1_700_000_000_000, duration: 1000 }),
      );

    await expect(provider.getRun(conn(), 'team/api', 'queue:42')).resolves.toMatchObject({
      providerRunId: '12',
      status: 'in_progress',
    });
    expect(urlOf(1)).toContain('https://ci.example.com/job/team/job/api/12/api/json');
    await expect(provider.getRun(conn(), 'team/api', 'queue:43')).resolves.toMatchObject({
      providerRunId: 'queue:43',
      status: 'queued',
    });

    const branchRun = await provider.getRun(conn(), 'team/web', 'queue:44');

    expect(branchRun).toMatchObject({ providerRunId: 'feature%2Fx/3', ref: 'feature/x', conclusion: 'success' });
    expect(branchRun.completedAt?.getTime()).toBe(1_700_000_001_000);
    expect(urlOf(4)).toContain('/job/team/job/web/job/feature%252Fx/3/api/json');
  });

  it('reads console logs (tail), exposes one console job and rejects other job ids', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('line1\nline2\n', { status: 200 }))
      .mockResolvedValueOnce(
        json({ number: 5, url: 'https://ci.example.com/job/deploy/5/', building: false, result: 'FAILURE' }),
      );

    await expect(provider.getRunLogs(conn(), 'deploy', '5', 6)).resolves.toEqual({ logs: 'line2\n', truncated: true });
    expect(urlOf(0)).toBe('https://ci.example.com/job/deploy/5/consoleText');

    const jobs = await provider.listJobs(conn(), 'deploy', '5');

    expect(jobs).toEqual([
      expect.objectContaining({ id: JENKINS_CONSOLE_JOB_ID, url: 'https://ci.example.com/job/deploy/5/console' }),
    ]);
    await expect(provider.getJobLogs(conn(), 'deploy', '5', 'other', 10)).rejects.toBeInstanceOf(NotFoundException);
    await expect(provider.getRun(conn(), 'deploy', '5;rm')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists builds', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        _class: 'hudson.model.FreeStyleProject',
        builds: [
          { number: 2, building: true },
          { number: 1, result: 'SUCCESS' },
        ],
      }),
    );

    const runs = await provider.listRuns(conn(), { repository: 'deploy', workflow: null, limit: 10 });

    expect(runs.map((r) => r.providerRunId)).toEqual(['2', '1']);
  });

  it('cancels queue items and stops builds', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 9 }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/' } }));

    await provider.cancelRun(conn(), 'deploy', 'queue:9');
    expect(urlOf(1)).toBe('https://ci.example.com/queue/cancelItem?id=9');
    await provider.cancelRun(conn(), 'deploy', '5');
    expect(urlOf(2)).toBe('https://ci.example.com/job/deploy/5/stop');
    expect(initOf(2)).toMatchObject({ method: 'POST', redirect: 'manual' });
  });
});
