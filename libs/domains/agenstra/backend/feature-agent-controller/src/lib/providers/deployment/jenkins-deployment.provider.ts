import type {
  DeploymentBranchSummary,
  DeploymentProviderWorkflowSummary,
  DeploymentRepositorySummary,
  DeploymentRunConclusion,
  DeploymentRunJobSummary,
  DeploymentRunLogs,
  DeploymentRunStatus,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadGatewayException, BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';

import {
  buildDeploymentBasicAuthHeader,
  deploymentRequest,
  deploymentRequestJson,
  encodeDeploymentPathSegment,
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

/** Max jobs returned by {@link JenkinsDeploymentProvider.listRepositories} (folder recursion is bounded too). */
const JENKINS_JOBS_MAX = 500;
const JENKINS_FOLDER_DEPTH = 4;
const QUEUE_PREFIX = 'queue:';
/** Single pseudo job id: Jenkins builds have one console log. */
export const JENKINS_CONSOLE_JOB_ID = 'console';
const BUILD_TREE =
  'number,url,building,result,timestamp,duration,displayName,fullDisplayName,actions[lastBuiltRevision[SHA1]]';

interface JenkinsJobNode {
  _class?: string;
  name?: string;
  fullName?: string;
  url?: string;
  jobs?: JenkinsJobNode[];
}

interface JenkinsBuild {
  number: number;
  url?: string | null;
  building?: boolean;
  result?: string | null;
  timestamp?: number | null;
  duration?: number | null;
  displayName?: string | null;
  fullDisplayName?: string | null;
  actions?: Array<{ lastBuiltRevision?: { SHA1?: string } } | null>;
}

interface JenkinsQueueItem {
  id: number;
  cancelled?: boolean;
  why?: string | null;
  task?: { name?: string; url?: string } | null;
  executable?: { number?: number; url?: string } | null;
}

export function mapJenkinsBuildStatus(build: Pick<JenkinsBuild, 'building' | 'result'>): {
  status: DeploymentRunStatus;
  conclusion: DeploymentRunConclusion | null;
} {
  if (build.building) {
    return { status: 'in_progress', conclusion: null };
  }

  switch ((build.result ?? '').toUpperCase()) {
    case 'SUCCESS':
      return { status: 'completed', conclusion: 'success' };
    case 'FAILURE':
    case 'UNSTABLE':
      return { status: 'completed', conclusion: 'failure' };
    case 'ABORTED':
      return { status: 'completed', conclusion: 'cancelled' };
    case 'NOT_BUILT':
      return { status: 'completed', conclusion: 'skipped' };
    case '':
      return { status: 'queued', conclusion: null };
    default:
      return { status: 'completed', conclusion: 'neutral' };
  }
}

function isMultiBranch(cls: string | undefined): boolean {
  return Boolean(cls && /MultiBranchProject|OrganizationFolder/.test(cls));
}

/**
 * Jenkins adapter. Repository = job full name (`folder/job`, multibranch project → branches are its child jobs).
 * `providerRunId`: `queue:{id}` until the queue item has an executable, then `{buildNumber}` (or
 * `{branchJob}/{buildNumber}` for multibranch projects). Auth: `username` + API token (HTTP Basic, CSRF-crumb exempt).
 */
@Injectable()
export class JenkinsDeploymentProvider implements DeploymentPipelineProvider {
  readonly provider = 'jenkins' as const;

  async testConnection(connection: DeploymentProviderConnection): Promise<DeploymentProviderTestResult> {
    try {
      const me = await this.api<{ id?: string; fullName?: string }>(
        connection,
        'test connection',
        '/me/api/json?tree=id,fullName',
      );

      return { ok: true, message: `Authenticated as ${me?.fullName || me?.id || connection.username}` };
    } catch (error) {
      const raw = error instanceof HttpException ? error.message : 'Jenkins: connection test failed';

      return { ok: false, message: sanitizeDeploymentProviderMessage(raw, [connection.secrets.token], 512) };
    }
  }

  async listRepositories(
    connection: DeploymentProviderConnection,
    search?: string,
  ): Promise<DeploymentRepositorySummary[]> {
    const fields = 'name,fullName,url,_class';
    let tree = fields;

    for (let i = 0; i < JENKINS_FOLDER_DEPTH; i++) {
      tree = `${fields},jobs[${tree}]`;
    }

    const root = await this.api<JenkinsJobNode>(
      connection,
      'list jobs',
      `/api/json?tree=${encodeURIComponent(`jobs[${tree}]`)}`,
    );
    const out: DeploymentRepositorySummary[] = [];
    const needle = search?.trim().toLowerCase();
    const visit = (nodes: JenkinsJobNode[] | undefined): void => {
      for (const node of nodes ?? []) {
        if (out.length >= JENKINS_JOBS_MAX) {
          return;
        }

        const fullName = node.fullName ?? node.name;

        if (!fullName) {
          continue;
        }

        if (!isMultiBranch(node._class) && Array.isArray(node.jobs)) {
          visit(node.jobs);
          continue;
        }

        if (needle && !fullName.toLowerCase().includes(needle)) {
          continue;
        }

        out.push({
          id: fullName,
          name: node.name ?? fullName,
          fullName,
          defaultBranch: null,
          url: node.url ?? null,
          private: true,
        });
      }
    };

    visit(root?.jobs);

    return out;
  }

  /** Branches exist only for multibranch projects (their child jobs); other jobs return `[]`. */
  async listBranches(connection: DeploymentProviderConnection, repository: string): Promise<DeploymentBranchSummary[]> {
    const job = await this.api<JenkinsJobNode>(
      connection,
      'load job',
      `${this.jobPath(repository)}/api/json?tree=${encodeURIComponent('_class,jobs[name,_class]')}`,
    );

    if (!isMultiBranch(job?._class)) {
      return [];
    }

    return (job?.jobs ?? [])
      .filter((j) => j.name)
      .map((j) => {
        const name = safeDecode(j.name as string);

        return { name, sha: null, default: name === 'main' || name === 'master' };
      });
  }

  async listWorkflows(): Promise<DeploymentProviderWorkflowSummary[]> {
    return [];
  }

  async trigger(
    connection: DeploymentProviderConnection,
    request: DeploymentProviderTriggerRequest,
  ): Promise<DeploymentProviderRunSnapshot> {
    const repoPath = this.jobPath(request.repository);
    const job = await this.api<{
      _class?: string;
      buildable?: boolean;
      property?: Array<{ parameterDefinitions?: Array<{ name: string }> } | null>;
    }>(
      connection,
      'load job',
      `${repoPath}/api/json?tree=${encodeURIComponent('_class,buildable,property[parameterDefinitions[name]]')}`,
    );
    let targetPath = repoPath;
    let params = (job?.property ?? []).flatMap((p) => p?.parameterDefinitions ?? []);

    if (isMultiBranch(job?._class)) {
      if (!request.ref) {
        throw new BadRequestException('Jenkins multibranch jobs require a branch');
      }

      // Branch jobs are named after the branch with `%` and `/` escaped (`feature%2Fx`); the URL encodes that name.
      const branchJobName = request.ref.replace(/%/g, '%25').replace(/\//g, '%2F');

      targetPath = `${repoPath}/job/${encodeDeploymentPathSegment(branchJobName, 'Branch')}`;

      const branchJob = await this.api<{
        property?: Array<{ parameterDefinitions?: Array<{ name: string }> } | null>;
      }>(
        connection,
        'load branch job',
        `${targetPath}/api/json?tree=${encodeURIComponent('property[parameterDefinitions[name]]')}`,
      );

      params = (branchJob?.property ?? []).flatMap((p) => p?.parameterDefinitions ?? []);
    }

    const inputs = request.inputs ?? {};
    const parameterized = params.length > 0;

    if (!parameterized && Object.keys(inputs).length > 0) {
      throw new BadRequestException('Jenkins job is not parameterized; remove the inputs');
    }

    const init: DeploymentRequestInit = { method: 'POST', redirect: 'manual' };

    if (parameterized) {
      const form = new URLSearchParams();

      for (const [k, v] of Object.entries(inputs)) {
        form.set(k, String(v));
      }

      init.body = form.toString();
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    }

    const res = await this.send(
      connection,
      'trigger build',
      `${targetPath}/${parameterized ? 'buildWithParameters' : 'build'}`,
      init,
    );
    const location = res.headers.get('location') ?? '';
    const match = /\/queue\/item\/(\d+)/.exec(location);

    return {
      providerRunId: match ? `${QUEUE_PREFIX}${match[1]}` : null,
      name: null,
      status: 'queued',
      conclusion: null,
      ref: request.ref || null,
      sha: null,
      url: null,
      startedAt: null,
      completedAt: null,
    };
  }

  async getRun(
    connection: DeploymentProviderConnection,
    repository: string,
    providerRunId: string,
  ): Promise<DeploymentProviderRunSnapshot> {
    const repoPath = this.jobPath(repository);
    const queueId = this.queueId(providerRunId);

    if (queueId) {
      const item = await this.api<JenkinsQueueItem>(connection, 'load queue item', `/queue/item/${queueId}/api/json`);

      if (item?.executable?.number) {
        const child = this.childFromTaskUrl(repository, item.task?.url);
        const build = await this.loadBuild(connection, this.buildPath(repoPath, child, item.executable.number));

        return this.mapBuild(build, child);
      }

      return {
        providerRunId,
        name: null,
        status: item?.cancelled ? 'completed' : 'queued',
        conclusion: item?.cancelled ? 'cancelled' : null,
        ref: null,
        sha: null,
        url: null,
        startedAt: null,
        completedAt: null,
      };
    }

    const { child, number } = this.parseBuildId(providerRunId);

    return this.mapBuild(await this.loadBuild(connection, this.buildPath(repoPath, child, number)), child);
  }

  async listRuns(
    connection: DeploymentProviderConnection,
    request: { repository: string; workflow: string | null; limit: number },
  ): Promise<DeploymentProviderRunSnapshot[]> {
    const limit = Math.min(Math.max(1, Math.floor(request.limit) || 1), 100);
    const job = await this.api<{
      _class?: string;
      builds?: JenkinsBuild[];
      jobs?: Array<{ name?: string; builds?: JenkinsBuild[] }>;
    }>(
      connection,
      'list builds',
      `${this.jobPath(request.repository)}/api/json?tree=${encodeURIComponent(
        `_class,builds[${BUILD_TREE}]{0,${limit}},jobs[name,builds[${BUILD_TREE}]{0,${limit}}]`,
      )}`,
    );

    if (isMultiBranch(job?._class)) {
      return (job?.jobs ?? [])
        .flatMap((j) => (j.name ? (j.builds ?? []).map((b) => this.mapBuild(b, j.name as string)) : []))
        .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))
        .slice(0, limit);
    }

    return (job?.builds ?? []).slice(0, limit).map((b) => this.mapBuild(b, null));
  }

  /** Jenkins builds have a single console log; exposed as one pseudo job (`console`). */
  async listJobs(
    connection: DeploymentProviderConnection,
    repository: string,
    providerRunId: string,
  ): Promise<DeploymentRunJobSummary[]> {
    const run = await this.getRun(connection, repository, providerRunId);

    if (!run.providerRunId || this.queueId(run.providerRunId)) {
      return [];
    }

    return [
      {
        id: JENKINS_CONSOLE_JOB_ID,
        name: run.name ?? 'Console',
        status: run.status,
        conclusion: run.conclusion,
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
        url: run.url ? `${run.url.replace(/\/+$/, '')}/console` : null,
      },
    ];
  }

  async getRunLogs(
    connection: DeploymentProviderConnection,
    repository: string,
    providerRunId: string,
    maxBytes: number,
  ): Promise<DeploymentRunLogs> {
    let buildId = providerRunId;

    if (this.queueId(providerRunId)) {
      const run = await this.getRun(connection, repository, providerRunId);

      if (!run.providerRunId || this.queueId(run.providerRunId)) {
        return { logs: '', truncated: false };
      }

      buildId = run.providerRunId;
    }

    const { child, number } = this.parseBuildId(buildId);
    const res = await this.send(
      connection,
      'load console log',
      `${this.buildPath(this.jobPath(repository), child, number)}/consoleText`,
      {},
    );
    const tail = await readDeploymentTextTail(res, maxBytes);

    return { logs: tail.text, truncated: tail.truncated };
  }

  async getJobLogs(
    connection: DeploymentProviderConnection,
    repository: string,
    providerRunId: string,
    jobId: string,
    maxBytes: number,
  ): Promise<DeploymentRunLogs> {
    if (jobId !== JENKINS_CONSOLE_JOB_ID) {
      throw new NotFoundException('Job not found');
    }

    return await this.getRunLogs(connection, repository, providerRunId, maxBytes);
  }

  async cancelRun(connection: DeploymentProviderConnection, repository: string, providerRunId: string): Promise<void> {
    const repoPath = this.jobPath(repository);
    const queueId = this.queueId(providerRunId);

    if (queueId) {
      const item = await this.api<JenkinsQueueItem>(connection, 'load queue item', `/queue/item/${queueId}/api/json`);

      if (!item?.executable?.number) {
        await this.send(connection, 'cancel queue item', `/queue/cancelItem?id=${queueId}`, {
          method: 'POST',
          redirect: 'manual',
        });

        return;
      }

      const child = this.childFromTaskUrl(repository, item.task?.url);

      await this.send(connection, 'stop build', `${this.buildPath(repoPath, child, item.executable.number)}/stop`, {
        method: 'POST',
        redirect: 'manual',
      });

      return;
    }

    const { child, number } = this.parseBuildId(providerRunId);

    await this.send(connection, 'stop build', `${this.buildPath(repoPath, child, number)}/stop`, {
      method: 'POST',
      redirect: 'manual',
    });
  }

  private mapBuild(build: JenkinsBuild, child: string | null): DeploymentProviderRunSnapshot {
    if (!build || typeof build.number !== 'number') {
      throw new BadGatewayException('Jenkins: failed to load build (unexpected response)');
    }

    const mapped = mapJenkinsBuildStatus(build);
    const startedAt = parseDeploymentDate(build.timestamp ?? null);
    const completedAt =
      mapped.status === 'completed' && startedAt
        ? new Date(startedAt.getTime() + Math.max(0, build.duration ?? 0))
        : null;
    const sha = (build.actions ?? []).find((a) => a?.lastBuiltRevision?.SHA1)?.lastBuiltRevision?.SHA1 ?? null;

    return {
      providerRunId: child ? `${child}/${build.number}` : String(build.number),
      name: build.fullDisplayName || build.displayName || `#${build.number}`,
      status: mapped.status,
      conclusion: mapped.conclusion,
      ref: child ? safeDecode(child) : null,
      sha,
      url: build.url ?? null,
      startedAt,
      completedAt,
    };
  }

  private async loadBuild(connection: DeploymentProviderConnection, buildPath: string): Promise<JenkinsBuild> {
    return await this.api<JenkinsBuild>(
      connection,
      'load build',
      `${buildPath}/api/json?tree=${encodeURIComponent(BUILD_TREE)}`,
    );
  }

  /** `a/b` → `/job/a/job/b` (each segment URL-encoded). */
  private jobPath(fullName: string): string {
    const value = (fullName ?? '').trim();

    if (!value || value.length > 512) {
      throw new BadRequestException('Jenkins job name is invalid');
    }

    return value
      .split('/')
      .map((segment) => `/job/${encodeDeploymentPathSegment(segment, 'Jenkins job name')}`)
      .join('');
  }

  /** `child` is the raw Jenkins child job name (already URL-encoded by Jenkins for multibranch branches). */
  private buildPath(repoPath: string, child: string | null, number: number): string {
    const childPath = child ? `/job/${encodeDeploymentPathSegment(child, 'Jenkins branch job')}` : '';

    return `${repoPath}${childPath}/${number}`;
  }

  private queueId(providerRunId: string): string | null {
    const value = (providerRunId ?? '').trim();

    if (!value.startsWith(QUEUE_PREFIX)) {
      return null;
    }

    const id = value.slice(QUEUE_PREFIX.length);

    if (!/^\d{1,20}$/.test(id)) {
      throw new BadRequestException('Run id is invalid');
    }

    return id;
  }

  private parseBuildId(providerRunId: string): { child: string | null; number: number } {
    const value = (providerRunId ?? '').trim();
    const slash = value.lastIndexOf('/');
    const child = slash >= 0 ? value.slice(0, slash) : null;
    const numberPart = slash >= 0 ? value.slice(slash + 1) : value;

    if (!/^\d{1,12}$/.test(numberPart) || (child !== null && (!child || child.includes('/')))) {
      throw new BadRequestException('Run id is invalid');
    }

    return { child, number: Number(numberPart) };
  }

  /** Child job name when the queue task is a branch job below the repository job (multibranch). */
  private childFromTaskUrl(repository: string, taskUrl: string | undefined): string | null {
    if (!taskUrl) {
      return null;
    }

    let path: string;

    try {
      path = new URL(taskUrl).pathname;
    } catch {
      return null;
    }

    const segments = path
      .split('/')
      .filter(Boolean)
      .filter((_, i, arr) => i > 0 && arr[i - 1] === 'job')
      .map((s) => safeDecode(s));
    const repoSegments = repository.trim().split('/');

    if (segments.length === repoSegments.length + 1 && repoSegments.every((s, i) => segments[i] === s)) {
      return segments[segments.length - 1];
    }

    return null;
  }

  private apiBase(connection: DeploymentProviderConnection): string {
    if (!connection.baseUrl) {
      throw new BadRequestException('Jenkins connection requires a base URL');
    }

    return connection.baseUrl.replace(/\/+$/, '');
  }

  private headers(connection: DeploymentProviderConnection): Record<string, string> {
    if (!connection.username || !connection.secrets.token) {
      throw new BadRequestException('Jenkins connection requires a username and an API token');
    }

    return {
      Authorization: buildDeploymentBasicAuthHeader(connection.username, connection.secrets.token),
      Accept: 'application/json',
    };
  }

  private ctx(connection: DeploymentProviderConnection, action: string): DeploymentHttpContext {
    return { providerLabel: 'Jenkins', action, secrets: [connection.secrets.token] };
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
      { ...init, headers: { ...this.headers(connection), ...((init.headers as Record<string, string>) ?? {}) } },
      this.ctx(connection, action),
    );
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
