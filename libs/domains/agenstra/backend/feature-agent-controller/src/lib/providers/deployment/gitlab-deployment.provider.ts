import type {
  DeploymentBranchSummary,
  DeploymentProviderWorkflowSummary,
  DeploymentRepositorySummary,
  DeploymentRunConclusion,
  DeploymentRunJobSummary,
  DeploymentRunLogs,
  DeploymentRunStatus,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, HttpException, Injectable } from '@nestjs/common';

import {
  deploymentFetch,
  deploymentProviderHttpError,
  deploymentRequest,
  deploymentRequestJson,
  encodeDeploymentPathSegment,
  joinDeploymentJobLogs,
  parseDeploymentDate,
  readDeploymentTextTail,
  sanitizeDeploymentProviderMessage,
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

const GITLAB_DEFAULT_BASE = 'https://gitlab.com';
const RUN_LOG_JOBS_MAX = 20;

interface GitLabPipeline {
  id: number;
  iid?: number;
  name?: string | null;
  status?: string | null;
  ref?: string | null;
  sha?: string | null;
  web_url?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

interface GitLabJob {
  id: number;
  name: string;
  stage?: string | null;
  status?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  web_url?: string | null;
}

/** Normalized status + conclusion of a GitLab pipeline / job status. */
export function mapGitLabStatus(status: string | null | undefined): {
  status: DeploymentRunStatus;
  conclusion: DeploymentRunConclusion | null;
} {
  switch ((status ?? '').toLowerCase()) {
    case 'running':
    case 'canceling':
      return { status: 'in_progress', conclusion: null };
    case 'success':
      return { status: 'completed', conclusion: 'success' };
    case 'failed':
      return { status: 'completed', conclusion: 'failure' };
    case 'canceled':
    case 'cancelled':
      return { status: 'completed', conclusion: 'cancelled' };
    case 'skipped':
      return { status: 'completed', conclusion: 'skipped' };
    case 'manual':
      // Blocked on a manual job: nothing runs until someone acts in GitLab.
      return { status: 'completed', conclusion: 'neutral' };
    default:
      // created, waiting_for_resource, preparing, pending, scheduled, waiting_for_callback
      return { status: 'queued', conclusion: null };
  }
}

/**
 * GitLab CI adapter (gitlab.com and self-managed; API at `{base}/api/v4`). Auth: `token` only (`PRIVATE-TOKEN`).
 * Repository = numeric project id or `group/project` path (URL-encoded as one segment).
 */
@Injectable()
export class GitLabDeploymentProvider implements DeploymentPipelineProvider {
  readonly provider = 'gitlab' as const;

  async testConnection(connection: DeploymentProviderConnection): Promise<DeploymentProviderTestResult> {
    try {
      const user = await this.api<{ username?: string }>(connection, 'test connection', '/user');

      return { ok: true, message: user?.username ? `Authenticated as ${user.username}` : 'Authenticated' };
    } catch (error) {
      const raw = error instanceof HttpException ? error.message : 'GitLab: connection test failed';

      return { ok: false, message: sanitizeDeploymentProviderMessage(raw, [connection.secrets.token], 512) };
    }
  }

  async listRepositories(
    connection: DeploymentProviderConnection,
    search?: string,
  ): Promise<DeploymentRepositorySummary[]> {
    const params = new URLSearchParams({
      membership: 'true',
      simple: 'true',
      per_page: '100',
      order_by: 'last_activity_at',
      archived: 'false',
    });
    const needle = search?.trim();

    if (needle) {
      params.set('search', needle);
      params.set('search_namespaces', 'true');
    }

    const projects =
      (await this.api<
        Array<{
          id: number;
          name: string;
          path_with_namespace: string;
          default_branch?: string | null;
          web_url?: string | null;
          visibility?: string | null;
        }>
      >(connection, 'list projects', `/projects?${params.toString()}`)) ?? [];

    return projects.map((p) => ({
      id: String(p.id),
      name: p.name,
      fullName: p.path_with_namespace,
      defaultBranch: p.default_branch ?? null,
      url: p.web_url ?? null,
      // `simple=true` omits visibility; treat unknown as private.
      private: p.visibility !== 'public',
    }));
  }

  async listBranches(connection: DeploymentProviderConnection, repository: string): Promise<DeploymentBranchSummary[]> {
    const project = this.projectPath(repository);
    const info = await this.api<{ default_branch?: string }>(connection, 'load project', project);
    const branches =
      (await this.api<Array<{ name: string; default?: boolean; commit?: { id?: string } }>>(
        connection,
        'list branches',
        `${project}/repository/branches?per_page=100`,
      )) ?? [];

    return branches.map((b) => ({
      name: b.name,
      sha: b.commit?.id ?? null,
      default: b.default ?? b.name === info?.default_branch,
    }));
  }

  /** GitLab has one pipeline definition per project (`.gitlab-ci.yml`). */
  async listWorkflows(): Promise<DeploymentProviderWorkflowSummary[]> {
    return [];
  }

  async trigger(
    connection: DeploymentProviderConnection,
    request: DeploymentProviderTriggerRequest,
  ): Promise<DeploymentProviderRunSnapshot> {
    const ctx = this.ctx(connection, 'create pipeline');
    const variables = Object.entries(request.inputs ?? {}).map(([key, value]) => ({
      key,
      value: String(value),
      variable_type: 'env_var',
    }));
    const pipeline = await deploymentRequestJson<GitLabPipeline>(
      `${this.apiBase(connection)}${this.projectPath(request.repository)}/pipeline`,
      {
        method: 'POST',
        headers: { ...this.headers(connection), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: request.ref, variables }),
      },
      ctx,
    );

    return this.mapPipeline(pipeline);
  }

  async getRun(
    connection: DeploymentProviderConnection,
    repository: string,
    providerRunId: string,
  ): Promise<DeploymentProviderRunSnapshot> {
    const pipeline = await this.api<GitLabPipeline>(
      connection,
      'load pipeline',
      `${this.projectPath(repository)}/pipelines/${this.numericId(providerRunId, 'Pipeline id')}`,
    );

    return this.mapPipeline(pipeline);
  }

  async listRuns(
    connection: DeploymentProviderConnection,
    request: { repository: string; workflow: string | null; limit: number },
  ): Promise<DeploymentProviderRunSnapshot[]> {
    const perPage = Math.min(Math.max(1, Math.floor(request.limit) || 1), 100);
    const pipelines =
      (await this.api<GitLabPipeline[]>(
        connection,
        'list pipelines',
        `${this.projectPath(request.repository)}/pipelines?per_page=${perPage}&order_by=id&sort=desc`,
      )) ?? [];

    return pipelines.map((p) => this.mapPipeline(p));
  }

  async listJobs(
    connection: DeploymentProviderConnection,
    repository: string,
    providerRunId: string,
  ): Promise<DeploymentRunJobSummary[]> {
    const jobs =
      (await this.api<GitLabJob[]>(
        connection,
        'list jobs',
        `${this.projectPath(repository)}/pipelines/${this.numericId(providerRunId, 'Pipeline id')}/jobs?per_page=100`,
      )) ?? [];

    return jobs
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((j) => {
        const mapped = mapGitLabStatus(j.status);

        return {
          id: String(j.id),
          name: j.stage ? `${j.stage}: ${j.name}` : j.name,
          status: mapped.status,
          conclusion: mapped.conclusion,
          startedAt: parseDeploymentDate(j.started_at)?.toISOString() ?? null,
          completedAt: parseDeploymentDate(j.finished_at)?.toISOString() ?? null,
          url: j.web_url ?? null,
        };
      });
  }

  async getRunLogs(
    connection: DeploymentProviderConnection,
    repository: string,
    providerRunId: string,
    maxBytes: number,
  ): Promise<DeploymentRunLogs> {
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
    const res = await deploymentFetch(
      `${this.apiBase(connection)}${this.projectPath(repository)}/jobs/${this.numericId(jobId, 'Job id')}/trace`,
      { headers: this.headers(connection) },
      ctx,
    );

    if (res.status === 404) {
      return { logs: '', truncated: false };
    }

    if (!res.ok) {
      throw deploymentProviderHttpError(res.status, await res.text().catch(() => ''), ctx);
    }

    const tail = await readDeploymentTextTail(res, maxBytes);

    return { logs: tail.text, truncated: tail.truncated };
  }

  async cancelRun(connection: DeploymentProviderConnection, repository: string, providerRunId: string): Promise<void> {
    await this.send(
      connection,
      'cancel pipeline',
      `${this.projectPath(repository)}/pipelines/${this.numericId(providerRunId, 'Pipeline id')}/cancel`,
      { method: 'POST' },
    );
  }

  private mapPipeline(p: GitLabPipeline): DeploymentProviderRunSnapshot {
    const mapped = mapGitLabStatus(p.status);

    return {
      providerRunId: String(p.id),
      name: p.name || `Pipeline #${p.iid ?? p.id}`,
      status: mapped.status,
      conclusion: mapped.conclusion,
      ref: p.ref ?? null,
      sha: p.sha ?? null,
      url: p.web_url ?? null,
      startedAt: parseDeploymentDate(p.started_at),
      completedAt: mapped.status === 'completed' ? parseDeploymentDate(p.finished_at) : null,
    };
  }

  private apiBase(connection: DeploymentProviderConnection): string {
    const base = (connection.baseUrl ?? GITLAB_DEFAULT_BASE).replace(/\/+$/, '');

    return base.endsWith('/api/v4') ? base : `${base}/api/v4`;
  }

  /** `/projects/{id}`: numeric id or URL-encoded `group/project` path. */
  private projectPath(repository: string): string {
    const value = (repository ?? '').trim();

    if (/^\d{1,20}$/.test(value)) {
      return `/projects/${value}`;
    }

    if (!/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/.test(value) || value.split('/').some((s) => s === '.' || s === '..')) {
      throw new BadRequestException('GitLab repository must be a project id or a group/project path');
    }

    return `/projects/${encodeDeploymentPathSegment(value, 'Repository')}`;
  }

  private numericId(value: string, label: string): string {
    if (!/^\d{1,20}$/.test((value ?? '').trim())) {
      throw new BadRequestException(`${label} is invalid`);
    }

    return value.trim();
  }

  private headers(connection: DeploymentProviderConnection): Record<string, string> {
    if (!connection.secrets.token) {
      throw new BadRequestException('GitLab connection has no access token configured');
    }

    return { 'PRIVATE-TOKEN': connection.secrets.token, Accept: 'application/json' };
  }

  private ctx(connection: DeploymentProviderConnection, action: string): DeploymentHttpContext {
    return { providerLabel: 'GitLab', action, secrets: [connection.secrets.token] };
  }

  private async api<T>(connection: DeploymentProviderConnection, action: string, path: string): Promise<T> {
    return await deploymentRequestJson<T>(
      `${this.apiBase(connection)}${path}`,
      { headers: this.headers(connection) },
      this.ctx(connection, action),
    );
  }

  private async send(
    connection: DeploymentProviderConnection,
    action: string,
    path: string,
    init: DeploymentRequestInit,
  ): Promise<Response> {
    return await deploymentRequest(
      `${this.apiBase(connection)}${path}`,
      { ...init, headers: this.headers(connection) },
      this.ctx(connection, action),
    );
  }
}
