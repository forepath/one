import { createHash, createPrivateKey, createSign } from 'crypto';

import type {
  DeploymentBranchSummary,
  DeploymentProviderWorkflowSummary,
  DeploymentRepositorySummary,
  DeploymentRunConclusion,
  DeploymentRunJobSummary,
  DeploymentRunLogs,
  DeploymentRunStatus,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadGatewayException, BadRequestException, HttpException, Injectable } from '@nestjs/common';

import {
  deploymentFetch,
  deploymentProviderHttpError,
  deploymentRequest,
  deploymentRequestJson,
  encodeDeploymentPathSegment,
  joinDeploymentJobLogs,
  parseDeploymentDate,
  readDeploymentJson,
  readDeploymentTextTail,
  sanitizeDeploymentProviderMessage,
  sleepDeployment,
  type DeploymentHttpContext,
  type DeploymentRequestInit,
} from './deployment-http.util';
import type {
  DeploymentPipelineProvider,
  DeploymentProviderConnection,
  DeploymentProviderRunSnapshot,
  DeploymentProviderTestResult,
  DeploymentProviderTriggerRequest,
} from './deployment-provider.interface';

const GITHUB_DEFAULT_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const REPOSITORY_PAGES_MAX = 5;
const RUN_LOG_JOBS_MAX = 20;
/** Refresh minted installation tokens this long before GitHub expires them. */
const INSTALLATION_TOKEN_REFRESH_MARGIN_MS = 60_000;

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  default_branch?: string | null;
  html_url?: string | null;
  private?: boolean;
}

interface GitHubRun {
  id: number;
  name?: string | null;
  display_title?: string | null;
  status?: string | null;
  conclusion?: string | null;
  head_branch?: string | null;
  head_sha?: string | null;
  html_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  run_started_at?: string | null;
  event?: string | null;
}

interface GitHubJob {
  id: number;
  name: string;
  status?: string | null;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url?: string | null;
}

interface CachedInstallationToken {
  fingerprint: string;
  token: string;
  expiresAt: number;
}

export function mapGitHubStatus(status: string | null | undefined): DeploymentRunStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'in_progress':
      return 'in_progress';
    case 'completed':
      return 'completed';
    default:
      // queued, requested, waiting, pending
      return 'queued';
  }
}

export function mapGitHubConclusion(conclusion: string | null | undefined): DeploymentRunConclusion | null {
  switch ((conclusion ?? '').toLowerCase()) {
    case '':
      return null;
    case 'success':
      return 'success';
    case 'cancelled':
      return 'cancelled';
    case 'skipped':
      return 'skipped';
    case 'timed_out':
      return 'timed_out';
    case 'neutral':
    case 'stale':
      return 'neutral';
    default:
      // failure, action_required, startup_failure
      return 'failure';
  }
}

/**
 * GitHub Actions adapter (github.com and GitHub Enterprise Server `https://host/api/v3`).
 * Auth: `app` (GitHub App JWT → installation access token, cached in memory per connection) or `token` (PAT).
 */
@Injectable()
export class GitHubDeploymentProvider implements DeploymentPipelineProvider {
  readonly provider = 'github' as const;

  /** Delay between attempts when resolving the run created by a `workflow_dispatch` (overridable in tests). */
  dispatchResolveDelayMs = 1_500;
  dispatchResolveAttempts = 3;

  private readonly installationTokens = new Map<string, CachedInstallationToken>();

  async testConnection(connection: DeploymentProviderConnection): Promise<DeploymentProviderTestResult> {
    try {
      if (connection.authType === 'app') {
        const res = await this.api<{ total_count?: number }>(
          connection,
          'test connection',
          '/installation/repositories?per_page=1',
        );

        return { ok: true, message: `GitHub App installation can access ${res?.total_count ?? 0} repositories` };
      }

      const user = await this.api<{ login?: string }>(connection, 'test connection', '/user');

      return { ok: true, message: user?.login ? `Authenticated as ${user.login}` : 'Authenticated' };
    } catch (error) {
      return { ok: false, message: this.safeMessage(error, connection) };
    }
  }

  async listRepositories(
    connection: DeploymentProviderConnection,
    search?: string,
  ): Promise<DeploymentRepositorySummary[]> {
    const repos: GitHubRepo[] = [];

    for (let page = 1; page <= REPOSITORY_PAGES_MAX; page++) {
      let batch: GitHubRepo[];

      if (connection.authType === 'app') {
        const res = await this.api<{ repositories?: GitHubRepo[] }>(
          connection,
          'list repositories',
          `/installation/repositories?per_page=100&page=${page}`,
        );

        batch = res?.repositories ?? [];
      } else {
        batch =
          (await this.api<GitHubRepo[]>(
            connection,
            'list repositories',
            `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
          )) ?? [];
      }

      repos.push(...batch);

      if (batch.length < 100) {
        break;
      }
    }

    const needle = search?.trim().toLowerCase();

    return repos
      .filter((r) => !needle || r.full_name.toLowerCase().includes(needle))
      .map((r) => ({
        id: r.full_name,
        name: r.name,
        fullName: r.full_name,
        defaultBranch: r.default_branch ?? null,
        url: r.html_url ?? null,
        private: Boolean(r.private),
      }));
  }

  async listBranches(connection: DeploymentProviderConnection, repository: string): Promise<DeploymentBranchSummary[]> {
    const repo = this.repoPath(repository);
    const info = await this.api<{ default_branch?: string }>(connection, 'load repository', repo);
    const branches =
      (await this.api<Array<{ name: string; commit?: { sha?: string } }>>(
        connection,
        'list branches',
        `${repo}/branches?per_page=100`,
      )) ?? [];

    return branches.map((b) => ({
      name: b.name,
      sha: b.commit?.sha ?? null,
      default: b.name === info?.default_branch,
    }));
  }

  async listWorkflows(
    connection: DeploymentProviderConnection,
    repository: string,
  ): Promise<DeploymentProviderWorkflowSummary[]> {
    const res = await this.api<{ workflows?: Array<{ id: number; name: string; path?: string; state?: string }> }>(
      connection,
      'list workflows',
      `${this.repoPath(repository)}/actions/workflows?per_page=100`,
    );

    return (res?.workflows ?? []).map((w) => ({
      id: String(w.id),
      name: w.name,
      path: w.path ?? null,
      state: w.state ?? null,
    }));
  }

  async trigger(
    connection: DeploymentProviderConnection,
    request: DeploymentProviderTriggerRequest,
  ): Promise<DeploymentProviderRunSnapshot> {
    if (!request.workflow) {
      throw new BadRequestException('GitHub deployments require a workflow');
    }

    const repo = this.repoPath(request.repository);
    const workflow = this.workflowSegment(request.workflow);
    // Small skew allowance: GitHub stamps `created_at` with its own clock.
    const dispatchedAt = new Date(Date.now() - 5_000);
    const body: Record<string, unknown> = { ref: request.ref, inputs: request.inputs ?? {} };

    // github.com returns the created run (HTTP 200) when asked; GHES versions without support reject unknown keys.
    if (this.isGitHubDotCom(connection)) {
      body['return_run_details'] = true;
    }

    const ctx = this.ctx(connection, 'trigger workflow');
    const res = await this.request(connection, `${repo}/actions/workflows/${workflow}/dispatches`, ctx, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.status === 200) {
      const details = await readDeploymentJson<{ workflow_run_id?: number; html_url?: string } | undefined>(res, ctx);

      if (details?.workflow_run_id) {
        try {
          return await this.getRun(connection, request.repository, String(details.workflow_run_id));
        } catch {
          return this.queuedSnapshot(request.ref, String(details.workflow_run_id), details.html_url ?? null);
        }
      }
    }

    for (let attempt = 0; attempt < this.dispatchResolveAttempts; attempt++) {
      await sleepDeployment(this.dispatchResolveDelayMs);

      const found = await this.resolveDispatchedRun(connection, {
        repository: request.repository,
        workflow: request.workflow,
        ref: request.ref,
        dispatchedAt,
      });

      if (found) {
        return found;
      }
    }

    // Not visible yet: the runs service resolves it later through `resolveDispatchedRun`.
    return this.queuedSnapshot(request.ref, null, null);
  }

  /**
   * Finds the run created by a `workflow_dispatch` at or after `dispatchedAt` (newest first), or null when GitHub has
   * not listed it yet. Used right after {@link trigger} and by the runs poller for runs without `providerRunId`.
   */
  async resolveDispatchedRun(
    connection: DeploymentProviderConnection,
    request: { repository: string; workflow: string; ref: string; dispatchedAt: Date },
  ): Promise<DeploymentProviderRunSnapshot | null> {
    const repo = this.repoPath(request.repository);
    const workflow = this.workflowSegment(request.workflow);
    const since = request.dispatchedAt.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const params = new URLSearchParams({
      event: 'workflow_dispatch',
      branch: request.ref,
      per_page: '10',
      created: `>=${since}`,
    });
    const res = await this.api<{ workflow_runs?: GitHubRun[] }>(
      connection,
      'resolve dispatched run',
      `${repo}/actions/workflows/${workflow}/runs?${params.toString()}`,
    );
    const candidates = (res?.workflow_runs ?? [])
      .filter((r) => {
        const created = parseDeploymentDate(r.created_at);

        return !created || created.getTime() >= request.dispatchedAt.getTime();
      })
      .sort(
        (a, b) =>
          (parseDeploymentDate(b.created_at)?.getTime() ?? 0) - (parseDeploymentDate(a.created_at)?.getTime() ?? 0),
      );

    return candidates.length ? this.mapRun(candidates[0]) : null;
  }

  async getRun(
    connection: DeploymentProviderConnection,
    repository: string,
    providerRunId: string,
  ): Promise<DeploymentProviderRunSnapshot> {
    const run = await this.api<GitHubRun>(
      connection,
      'load run',
      `${this.repoPath(repository)}/actions/runs/${this.runId(providerRunId)}`,
    );

    return this.mapRun(run);
  }

  async listRuns(
    connection: DeploymentProviderConnection,
    request: { repository: string; workflow: string | null; limit: number },
  ): Promise<DeploymentProviderRunSnapshot[]> {
    const repo = this.repoPath(request.repository);
    const perPage = Math.min(Math.max(1, Math.floor(request.limit) || 1), 100);
    const path = request.workflow
      ? `${repo}/actions/workflows/${this.workflowSegment(request.workflow)}/runs?per_page=${perPage}`
      : `${repo}/actions/runs?per_page=${perPage}`;
    const res = await this.api<{ workflow_runs?: GitHubRun[] }>(connection, 'list runs', path);

    return (res?.workflow_runs ?? []).map((r) => this.mapRun(r));
  }

  async listJobs(
    connection: DeploymentProviderConnection,
    repository: string,
    providerRunId: string,
  ): Promise<DeploymentRunJobSummary[]> {
    const res = await this.api<{ jobs?: GitHubJob[] }>(
      connection,
      'list jobs',
      `${this.repoPath(repository)}/actions/runs/${this.runId(providerRunId)}/jobs?per_page=100`,
    );

    return (res?.jobs ?? []).map((j) => {
      const status = mapGitHubStatus(j.status);

      return {
        id: String(j.id),
        name: j.name,
        status,
        conclusion: status === 'completed' ? mapGitHubConclusion(j.conclusion) : null,
        startedAt: parseDeploymentDate(j.started_at)?.toISOString() ?? null,
        completedAt: parseDeploymentDate(j.completed_at)?.toISOString() ?? null,
        url: j.html_url ?? null,
      };
    });
  }

  async getRunLogs(
    connection: DeploymentProviderConnection,
    repository: string,
    providerRunId: string,
    maxBytes: number,
  ): Promise<DeploymentRunLogs> {
    // Run logs are a zip archive; concatenate the plain-text job logs instead.
    const jobs = (await this.listJobs(connection, repository, providerRunId)).slice(0, RUN_LOG_JOBS_MAX);
    const parts: Array<{ name: string; logs: string; truncated: boolean }> = [];

    for (const job of jobs) {
      const logs = await this.getJobLogs(connection, repository, providerRunId, job.id, maxBytes);

      parts.push({ name: job.name, logs: logs.logs, truncated: logs.truncated });
    }

    return joinDeploymentJobLogs(parts, maxBytes);
  }

  async getJobLogs(
    connection: DeploymentProviderConnection,
    repository: string,
    _providerRunId: string,
    jobId: string,
    maxBytes: number,
  ): Promise<DeploymentRunLogs> {
    const ctx = this.ctx(connection, 'load job logs');
    // GitHub answers with a redirect to a signed download URL; fetch drops `Authorization` on cross-origin redirects.
    const res = await deploymentFetch(
      `${this.apiBase(connection)}${this.repoPath(repository)}/actions/jobs/${this.runId(jobId, 'Job id')}/logs`,
      { headers: await this.headers(connection) },
      ctx,
    );

    if (res.status === 404 || res.status === 410) {
      return { logs: '', truncated: false };
    }

    if (!res.ok) {
      throw deploymentProviderHttpError(res.status, await res.text().catch(() => ''), ctx);
    }

    const tail = await readDeploymentTextTail(res, maxBytes);

    return { logs: tail.text, truncated: tail.truncated };
  }

  async cancelRun(connection: DeploymentProviderConnection, repository: string, providerRunId: string): Promise<void> {
    await this.request(
      connection,
      `${this.repoPath(repository)}/actions/runs/${this.runId(providerRunId)}/cancel`,
      this.ctx(connection, 'cancel run'),
      { method: 'POST' },
    );
  }

  /** Drops a cached installation token (e.g. after the connection credentials changed). */
  clearCachedToken(connectionId: string): void {
    this.installationTokens.delete(connectionId);
  }

  private queuedSnapshot(ref: string, providerRunId: string | null, url: string | null): DeploymentProviderRunSnapshot {
    return {
      providerRunId,
      name: null,
      status: 'queued',
      conclusion: null,
      ref,
      sha: null,
      url,
      startedAt: null,
      completedAt: null,
    };
  }

  private mapRun(run: GitHubRun): DeploymentProviderRunSnapshot {
    const status = mapGitHubStatus(run.status);

    return {
      providerRunId: String(run.id),
      name: run.display_title || run.name || null,
      status,
      conclusion: status === 'completed' ? mapGitHubConclusion(run.conclusion) : null,
      ref: run.head_branch ?? null,
      sha: run.head_sha ?? null,
      url: run.html_url ?? null,
      startedAt: parseDeploymentDate(run.run_started_at ?? run.created_at),
      completedAt: status === 'completed' ? parseDeploymentDate(run.updated_at) : null,
    };
  }

  private isGitHubDotCom(connection: DeploymentProviderConnection): boolean {
    return this.apiBase(connection) === GITHUB_DEFAULT_API;
  }

  private apiBase(connection: DeploymentProviderConnection): string {
    return (connection.baseUrl ?? GITHUB_DEFAULT_API).replace(/\/+$/, '');
  }

  private repoPath(repository: string): string {
    const parts = (repository ?? '').trim().split('/');

    if (parts.length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) {
      throw new BadRequestException('GitHub repository must be in the form owner/repo');
    }

    return `/repos/${encodeDeploymentPathSegment(parts[0], 'Repository owner')}/${encodeDeploymentPathSegment(parts[1], 'Repository')}`;
  }

  /** Workflow id or file name; a repository path (`.github/workflows/x.yml`) is reduced to its file name. */
  private workflowSegment(workflow: string): string {
    const value = (workflow ?? '').trim();
    const name = value.includes('/') ? value.slice(value.lastIndexOf('/') + 1) : value;

    return encodeDeploymentPathSegment(name, 'Workflow');
  }

  private runId(value: string, label = 'Run id'): string {
    if (!/^\d{1,20}$/.test((value ?? '').trim())) {
      throw new BadRequestException(`${label} is invalid`);
    }

    return value.trim();
  }

  private ctx(connection: DeploymentProviderConnection, action: string): DeploymentHttpContext {
    return {
      providerLabel: 'GitHub',
      action,
      secrets: [
        connection.secrets.token,
        connection.secrets.privateKey,
        this.installationTokens.get(connection.id)?.token,
      ],
    };
  }

  private async api<T>(connection: DeploymentProviderConnection, action: string, path: string): Promise<T> {
    const ctx = this.ctx(connection, action);
    const res = await this.request(connection, path, ctx, {});

    return await readDeploymentJson<T>(res, ctx);
  }

  private async request(
    connection: DeploymentProviderConnection,
    path: string,
    ctx: DeploymentHttpContext,
    init: DeploymentRequestInit,
  ): Promise<Response> {
    try {
      return await deploymentRequest(
        `${this.apiBase(connection)}${path}`,
        { ...init, headers: { ...(await this.headers(connection)), ...(init.headers as Record<string, string>) } },
        ctx,
      );
    } catch (error) {
      if (error instanceof HttpException && connection.authType === 'app' && error.message.includes('HTTP 401')) {
        this.clearCachedToken(connection.id);
      }

      throw error;
    }
  }

  private async headers(connection: DeploymentProviderConnection): Promise<Record<string, string>> {
    const token = connection.authType === 'app' ? await this.installationToken(connection) : connection.secrets.token;

    if (!token) {
      throw new BadRequestException('GitHub connection has no access token configured');
    }

    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'agenstra-agent-controller',
    };
  }

  private async installationToken(connection: DeploymentProviderConnection): Promise<string> {
    const { appId, installationId } = connection;
    const privateKey = connection.secrets.privateKey;

    if (!appId || !installationId || !privateKey) {
      throw new BadRequestException('GitHub App connection requires appId, installationId and privateKey');
    }

    const fingerprint = createHash('sha256')
      .update(`${this.apiBase(connection)}\n${appId}\n${installationId}\n${privateKey}`)
      .digest('hex');
    const cached = this.installationTokens.get(connection.id);

    if (
      cached &&
      cached.fingerprint === fingerprint &&
      cached.expiresAt - INSTALLATION_TOKEN_REFRESH_MARGIN_MS > Date.now()
    ) {
      return cached.token;
    }

    const jwt = createGitHubAppJwt(appId, privateKey);
    const ctx: DeploymentHttpContext = {
      providerLabel: 'GitHub',
      action: 'mint installation token',
      secrets: [privateKey, jwt],
    };
    const res = await deploymentRequestJson<{ token?: string; expires_at?: string }>(
      `${this.apiBase(connection)}/app/installations/${encodeDeploymentPathSegment(installationId, 'Installation id')}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
          'User-Agent': 'agenstra-agent-controller',
        },
      },
      ctx,
    );

    if (!res?.token) {
      throw new BadGatewayException('GitHub: failed to mint installation token (no token returned)');
    }

    const expiresAt = parseDeploymentDate(res.expires_at)?.getTime() ?? Date.now() + 10 * 60_000;

    this.installationTokens.set(connection.id, { fingerprint, token: res.token, expiresAt });

    return res.token;
  }

  private safeMessage(error: unknown, connection: DeploymentProviderConnection): string {
    const raw = error instanceof HttpException ? error.message : 'GitHub: connection test failed';

    return sanitizeDeploymentProviderMessage(raw, [connection.secrets.token, connection.secrets.privateKey], 512);
  }
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** GitHub App JWT (RS256, `iss` = app id, valid 9 minutes, backdated 60s for clock drift). */
export function createGitHubAppJwt(appId: string, privateKeyPem: string, now = Date.now()): string {
  let key: ReturnType<typeof createPrivateKey>;

  try {
    key = createPrivateKey(privateKeyPem.replace(/\\n/g, '\n'));
  } catch {
    throw new BadRequestException('GitHub App private key is not a valid PEM key');
  }

  const iat = Math.floor(now / 1000) - 60;
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ iat, exp: iat + 600, iss: appId }));
  const signer = createSign('RSA-SHA256');

  signer.update(`${header}.${payload}`);

  return `${header}.${payload}.${base64Url(signer.sign(key))}`;
}
