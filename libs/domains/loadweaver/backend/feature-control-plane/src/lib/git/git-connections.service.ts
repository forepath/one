import type { RequestWithUser } from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { canReadProject, projectRole, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import {
  toGitCommitDto,
  toGitConnectionDto,
  type CreateGitConnectionDto,
  type GitCommitDto,
  type GitConnectionDto,
  type UpdateGitConnectionDto,
} from '../dto/git.dto';
import {
  GIT_MODES,
  GIT_PROVIDERS,
  GitCommitEntity,
  GitConnectionEntity,
  GitPullRequestEntity,
  GitResourceStateEntity,
  GitSopsKeyEntity,
} from '../entities/git.entity';
import { PlanEntity } from '../entities/plan.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { lockTable, releaseLocks } from '../plans/apply-operation.service';
import { actorFromRequest, AuditLogService } from '../services/audit-log.service';
import { ChangeEventsService } from '../services/change-events.service';
import { PlatformCredentialsService } from '../services/platform-credentials.service';
import type { GitAuth, GitRemote } from './git-client';
import { GitHubAppTokens, sameApiBase } from './github-app';
import { newWebhookSalt, webhookSecret } from './git-sync.utils';
import { assertBranch, GitUrlError, normalizeRepoDir, parseRepoUrl, providerApiBase, repoSlug } from './git-url.utils';
import type { GitProviderContext } from './providers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_REF = /^secret:\/\/([a-z0-9-]+)\/[a-z0-9][a-z0-9._-]*$/;

/**
 * Settings that decide which repository content (and so which `access.yaml`) a connection reads: changing any of them
 * with memberships from Git on is like enabling it anew (3.17: who may hand out admin roles).
 */
const SOURCE_SETTINGS = ['provider', 'repoUrl', 'branch', 'path', 'credentials', 'apiUrl', 'caCertificate'] as const;

/** HTTPS user names that go with a token, per provider (GitHub app / PAT, GitLab tokens, Gitea / plain Git). */
const TOKEN_USERS = { github: 'x-access-token', gitlab: 'oauth2', gitea: 'loadweaver', git: 'git' } as const;

function looksLikePrivateKey(value: string): boolean {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value);
}

/** Credentials of a connection, read from its secret (token, SSH key, or JSON with both). */
export interface ConnectionCredentials {
  token: string | null;
  username: string | null;
  sshPrivateKey: string | null;
}

export function parseConnectionCredentials(config: Record<string, string>): ConnectionCredentials {
  const plain = config['apiToken'] ?? null;
  const sshPrivateKey =
    config['sshPrivateKey'] ?? config['privateKey'] ?? (plain && looksLikePrivateKey(plain) ? plain : null);
  const token = config['token'] ?? (plain && !looksLikePrivateKey(plain) ? plain : null);

  return { token, username: config['username'] ?? null, sshPrivateKey };
}

/**
 * Git connections (3.29), managed directly like memberships: cluster admins the cluster scope, project admins their
 * project's. Every change is audited; the webhook secret is derived and shown on create and on demand.
 */
@Injectable()
export class GitConnectionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditLogService,
    private readonly credentials: PlatformCredentialsService,
    private readonly appTokens: GitHubAppTokens,
    private readonly events: ChangeEventsService,
  ) {}

  private mayAdmin(caller: AccessCaller, project: string | null): boolean {
    return project === null ? caller.clusterRole === 'cluster-admin' : projectRole(caller, project) === 'admin';
  }

  /**
   * Memberships from Git can grant and revoke every role of the scope, project admins included: only who may manage
   * those (cluster admins, the project's creator, 3.17) may hand that to the repository.
   */
  private async mayManageAdmins(caller: AccessCaller, project: string | null): Promise<boolean> {
    if (caller.clusterRole === 'cluster-admin') return true;

    const createdBy = project ? (await this.access.settings(this.dataSource.manager, project)).createdBy : null;

    return !!project && !!caller.userId && createdBy === caller.userId;
  }

  private async assertMayManageAdmins(caller: AccessCaller, project: string | null): Promise<void> {
    if (!(await this.mayManageAdmins(caller, project)))
      throw new ForbiddenException(
        'memberships from Git can grant project admin roles: only cluster admins and the project creator may enable them',
      );
  }

  /** The GitHub App's installations may cover other teams' repositories: only cluster admins hand it out. */
  private assertMayUseApp(caller: AccessCaller, provider: string): void {
    if (provider !== 'github') throw new BadRequestException('githubApp is only for GitHub connections');

    if (caller.clusterRole !== 'cluster-admin')
      throw new ForbiddenException('only cluster admins may let a connection use the GitHub App');
  }

  private mayRead(caller: AccessCaller, project: string | null): boolean {
    return project === null ? !!caller.clusterRole : canReadProject(caller, project);
  }

  /** The connection, if the caller may administer it (404 for what they can't see, 403 for read-only callers). */
  async forAdmin(req: RequestWithUser | undefined, id: string): Promise<GitConnectionEntity> {
    const caller = await this.access.caller(req);
    const connection = await this.find(id);

    if (!connection || !this.mayRead(caller, connection.project)) throw new NotFoundException('connection not found');

    if (!this.mayAdmin(caller, connection.project))
      throw new ForbiddenException(
        connection.project ? `project ${connection.project}: admin role required` : 'cluster admin role required',
      );

    return connection;
  }

  async find(id: string): Promise<GitConnectionEntity | null> {
    if (!UUID.test(id)) return null;

    return await this.dataSource.getRepository(GitConnectionEntity).findOne({ where: { id } });
  }

  async list(req: RequestWithUser | undefined): Promise<GitConnectionDto[]> {
    const caller = await this.access.caller(req);

    const recipient = await this.sopsRecipient();

    return (await this.dataSource.getRepository(GitConnectionEntity).find({ order: { scopeKey: 'ASC' } }))
      .filter((c) => this.mayRead(caller, c.project))
      .map((c) => toGitConnectionDto(c, recipient));
  }

  async get(req: RequestWithUser | undefined, id: string): Promise<GitConnectionDto> {
    const caller = await this.access.caller(req);
    const connection = await this.find(id);

    if (!connection || !this.mayRead(caller, connection.project)) throw new NotFoundException('connection not found');

    return toGitConnectionDto(connection, await this.sopsRecipient());
  }

  /** The cluster's public SOPS recipient, once it exists (shown on connections with SOPS). */
  private async sopsRecipient(): Promise<string | null> {
    return (
      (await this.dataSource.getRepository(GitSopsKeyEntity).findOne({ where: { id: 'cluster' } }))?.recipient ?? null
    );
  }

  async commits(req: RequestWithUser | undefined, id: string, limit = 50): Promise<GitCommitDto[]> {
    await this.get(req, id);

    return (
      await this.dataSource.getRepository(GitCommitEntity).find({
        where: { connectionId: id },
        order: { createdAt: 'DESC' },
        take: Math.min(Math.max(limit, 1), 200),
      })
    ).map(toGitCommitDto);
  }

  /** Validates settings; throws 400 with the reason. */
  private validate(
    project: string | null,
    settings: Pick<
      GitConnectionEntity,
      | 'provider'
      | 'repoUrl'
      | 'branch'
      | 'path'
      | 'credentials'
      | 'apiUrl'
      | 'caCertificate'
      | 'pollIntervalSeconds'
      | 'webhook'
    >,
  ): string {
    try {
      if (!(GIT_PROVIDERS as readonly unknown[]).includes(settings.provider))
        throw new GitUrlError(`provider must be one of ${GIT_PROVIDERS.join(', ')}`);

      if (typeof settings.repoUrl !== 'string' || typeof settings.branch !== 'string')
        throw new GitUrlError('repoUrl and branch are required');

      if (typeof settings.path !== 'string') throw new GitUrlError('path must be a string');

      const url = parseRepoUrl(settings.repoUrl);

      assertBranch(settings.branch);
      providerApiBase(settings.provider, url, settings.apiUrl);

      if (url.transport === 'ssh' && !settings.credentials)
        throw new GitUrlError('SSH repositories need a deploy key (credentials)');

      if (settings.caCertificate && !/-----BEGIN CERTIFICATE-----/.test(settings.caCertificate))
        throw new GitUrlError('caCertificate must be PEM certificates');

      if (settings.caCertificate && /PRIVATE KEY/.test(settings.caCertificate))
        throw new GitUrlError('caCertificate must not contain a private key');

      if (!settings.webhook && !settings.pollIntervalSeconds)
        throw new GitUrlError('enable webhooks or polling (pollIntervalSeconds), otherwise nothing is synced');

      // A project's connection may only use its own secrets: the token is sent to the configured host.
      const ref = settings.credentials ? SECRET_REF.exec(settings.credentials) : null;

      if (project !== null && ref && ref[1] !== project)
        throw new GitUrlError(
          `credentials of project ${project} must be one of its own secrets (secret://${project}/...)`,
        );

      return normalizeRepoDir(settings.path);
    } catch (error) {
      if (error instanceof GitUrlError || error instanceof TypeError)
        throw new BadRequestException(error.message || 'invalid connection settings');

      throw error;
    }
  }

  async create(
    req: RequestWithUser | undefined,
    dto: CreateGitConnectionDto,
  ): Promise<GitConnectionDto & { webhookSecret: string }> {
    const caller = await this.access.caller(req);
    const project = dto.project ?? null;

    if (!this.mayAdmin(caller, project))
      throw new ForbiddenException(project ? `project ${project}: admin role required` : 'cluster admin role required');

    if (
      project &&
      !(await this.dataSource.getRepository(ResourceEntity).findOne({ where: { kind: 'Project', name: project } }))
    )
      throw new NotFoundException('project not found');

    const settings = {
      provider: dto.provider,
      repoUrl: dto.repoUrl,
      branch: dto.branch,
      path: dto.path ?? '',
      mode: dto.mode,
      credentials: dto.credentials ?? null,
      apiUrl: dto.apiUrl ?? null,
      caCertificate: dto.caCertificate ?? null,
      pollIntervalSeconds: dto.pollIntervalSeconds ?? null,
      webhook: dto.webhook ?? true,
      approvalByMergeReview: dto.approvalByMergeReview ?? false,
      membershipsFromGit: dto.membershipsFromGit ?? false,
      autoMerge: dto.autoMerge ?? true,
      sops: dto.sops ?? false,
      githubApp: dto.githubApp ?? false,
      webhookSalt: newWebhookSalt(),
    };

    if (settings.githubApp) this.assertMayUseApp(caller, settings.provider);

    settings.path = this.validate(project, settings);

    if (settings.membershipsFromGit) await this.assertMayManageAdmins(caller, project);

    const actor = actorFromRequest(req);
    const saved = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(GitConnectionEntity);

      if (await repo.findOne({ where: { scopeKey: project ?? '' } }))
        throw new ConflictException(`${project ? `project ${project}` : 'the cluster scope'} already has a connection`);

      const entity = await repo.save(
        repo.create({
          ...settings,
          project,
          scopeKey: project ?? '',
          createdBy: actor.person ?? actor.id ?? actor.type,
        }),
      );

      await this.audit.record(manager, {
        actor,
        action: 'git.connection.create',
        target: `git/connection/${entity.id}`,
        project,
        details: {
          provider: entity.provider,
          repoUrl: entity.repoUrl,
          branch: entity.branch,
          path: entity.path,
          mode: entity.mode,
        },
      });

      return entity;
    });

    return { ...toGitConnectionDto(saved), webhookSecret: this.webhookSecretOf(saved) };
  }

  async update(req: RequestWithUser | undefined, id: string, dto: UpdateGitConnectionDto): Promise<GitConnectionDto> {
    const connection = await this.forAdmin(req, id);
    const before = toGitConnectionDto(connection, await this.sopsRecipient());
    const next: GitConnectionEntity = Object.assign(new GitConnectionEntity(), connection);

    for (const key of [
      'provider',
      'repoUrl',
      'branch',
      'path',
      'mode',
      'credentials',
      'apiUrl',
      'caCertificate',
      'pollIntervalSeconds',
      'webhook',
      'approvalByMergeReview',
      'membershipsFromGit',
      'autoMerge',
      'sops',
      'githubApp',
    ] as const) {
      if (dto[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = dto[key];
    }

    // Non-nullable settings can't be cleared (`null` is only valid for the optional ones).
    for (const key of [
      'provider',
      'repoUrl',
      'branch',
      'path',
      'mode',
      'webhook',
      'approvalByMergeReview',
      'membershipsFromGit',
      'autoMerge',
      'sops',
      'githubApp',
    ] as const)
      if ((dto as Record<string, unknown>)[key] === null) throw new BadRequestException(`${key} cannot be null`);

    if (!(GIT_MODES as readonly unknown[]).includes(next.mode))
      throw new BadRequestException(`mode must be one of ${GIT_MODES.join(', ')}`);

    next.path = this.validate(connection.project, next);

    const caller = await this.access.caller(req);
    const sourceChanged = SOURCE_SETTINGS.some((k) => next[k] !== connection[k]);

    // Memberships from Git (3.17): enabling it, or pointing an enabled connection at other content (repository,
    // branch, path, credentials, provider, API, CA), needs who may manage admins; others' changes turn it off.
    if (next.membershipsFromGit && (!connection.membershipsFromGit || sourceChanged)) {
      if (!(await this.mayManageAdmins(caller, connection.project))) {
        if (dto.membershipsFromGit === true || !connection.membershipsFromGit)
          await this.assertMayManageAdmins(caller, connection.project);

        next.membershipsFromGit = false;
      }
    }

    if (next.githubApp && !connection.githubApp) this.assertMayUseApp(caller, next.provider);

    // The app's token reaches whatever repository is configured: only a cluster admin may point it elsewhere.
    if (
      next.githubApp &&
      caller.clusterRole !== 'cluster-admin' &&
      (next.repoUrl !== connection.repoUrl ||
        next.apiUrl !== connection.apiUrl ||
        next.provider !== connection.provider)
    )
      next.githubApp = false;

    // Another repository / branch / path is another history: sync from scratch, and pin the new host's key anew.
    if (next.repoUrl !== connection.repoUrl) next.hostKey = null;

    const otherHistory =
      next.repoUrl !== connection.repoUrl || next.branch !== connection.branch || next.path !== connection.path;

    if (otherHistory) {
      next.lastSyncedCommit = null;
      next.lastError = null;
      next.pushAuthors = null;
    }

    return await this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(GitConnectionEntity).save(next);

      // The synced files of the old repository / branch / path mean nothing for the new one.
      if (otherHistory) await manager.getRepository(GitResourceStateEntity).delete({ connectionId: id });

      const after = toGitConnectionDto(saved, await this.sopsRecipient());

      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'git.connection.update',
        target: `git/connection/${id}`,
        project: connection.project,
        details: {
          changed: Object.fromEntries(
            Object.entries(after)
              .filter(
                ([k, v]) =>
                  !['updatedAt', 'lastError'].includes(k) &&
                  JSON.stringify(v) !== JSON.stringify(before[k as keyof GitConnectionDto]),
              )
              .map(([k, v]) => [k, k === 'caCertificate' ? '(changed)' : v]),
          ),
        },
      });

      return after;
    });
  }

  /** Disconnects: the pending plans of its pull requests are discarded and their locks released (3.30). */
  async remove(req: RequestWithUser | undefined, id: string): Promise<void> {
    const connection = await this.forAdmin(req, id);
    const discarded: string[] = [];

    await this.dataSource.transaction(async (manager) => {
      const prPlans = (await manager.getRepository(GitPullRequestEntity).find({ where: { connectionId: id } })).flatMap(
        (p) => [p.planId, p.applyPlanId].filter((x): x is string => !!x),
      );

      if (prPlans.length > 0) {
        await lockTable(manager);

        for (const planId of new Set(prPlans)) {
          const plan = await manager.getRepository(PlanEntity).findOne({ where: { id: planId } });

          // Applying plans keep their locks until they finish (3.19).
          if (plan?.status !== 'pending') continue;

          await releaseLocks(manager, planId);
          await manager.getRepository(PlanEntity).update({ id: planId, status: 'pending' }, { status: 'discarded' });
          discarded.push(planId);
        }
      }

      await manager.getRepository(GitConnectionEntity).delete({ id });
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'git.connection.delete',
        target: `git/connection/${id}`,
        project: connection.project,
        details: {
          repoUrl: connection.repoUrl,
          branch: connection.branch,
          ...(discarded.length > 0 ? { discardedPlans: discarded } : {}),
        },
      });
    });

    for (const planId of discarded) this.events.planStatus(planId, 'discarded');
  }

  /** The derived webhook secret (admins of the scope; reading it is audited). */
  async revealWebhookSecret(req: RequestWithUser | undefined, id: string): Promise<{ webhookSecret: string }> {
    const connection = await this.forAdmin(req, id);

    await this.audit.recordStandalone({
      actor: actorFromRequest(req),
      action: 'git.connection.webhook-secret',
      target: `git/connection/${id}`,
      project: connection.project,
    });

    return { webhookSecret: this.webhookSecretOf(connection) };
  }

  /**
   * A new webhook secret (new random salt in the derivation): the old one stops working at once, so a leaked secret is
   * revoked without recreating the connection. Admins of the scope; audited.
   */
  async rotateWebhookSecret(
    req: RequestWithUser | undefined,
    id: string,
  ): Promise<{ webhookSecret: string; webhookGeneration: number }> {
    const connection = await this.forAdmin(req, id);
    const salt = newWebhookSalt();
    const generation = connection.webhookGeneration + 1;

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(GitConnectionEntity)
        .update({ id }, { webhookSalt: salt, webhookGeneration: generation });
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'git.connection.webhook-secret-rotated',
        target: `git/connection/${id}`,
        project: connection.project,
        details: { generation },
      });
    });

    return { webhookSecret: this.webhookSecretOf({ id, webhookSalt: salt }), webhookGeneration: generation };
  }

  /** Forgets the pinned SSH host key: the next contact pins the key it sees (after a legitimate key rotation). */
  async resetHostKey(req: RequestWithUser | undefined, id: string): Promise<GitConnectionDto> {
    const connection = await this.forAdmin(req, id);

    return await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(GitConnectionEntity).update({ id }, { hostKey: null, lastError: null });
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'git.connection.host-key-reset',
        target: `git/connection/${id}`,
        project: connection.project,
        details: { previous: connection.hostKey },
      });

      return toGitConnectionDto(await manager.getRepository(GitConnectionEntity).findOneOrFail({ where: { id } }));
    });
  }

  webhookSecretOf(connection: Pick<GitConnectionEntity, 'id' | 'webhookSalt'>): string {
    const key = process.env['ENCRYPTION_KEY'];

    if (!key) throw new ConflictException('ENCRYPTION_KEY is not set: webhook secrets cannot be derived');

    return webhookSecret(key, connection.id, connection.webhookSalt ?? null);
  }

  private async readCredentials(connection: GitConnectionEntity): Promise<ConnectionCredentials> {
    if (!connection.credentials) return { token: null, username: null, sshPrivateKey: null };

    return parseConnectionCredentials(await this.credentials.providerConfig(connection.credentials));
  }

  /**
   * GitHub connections without their own token use the Loadweaver GitHub App's installation token (3.30), if the
   * cluster has one configured.
   */
  private async appToken(connection: GitConnectionEntity): Promise<string | null> {
    if (connection.provider !== 'github' || !connection.githubApp) return null;

    const url = parseRepoUrl(connection.repoUrl);
    const apiBase = providerApiBase(connection.provider, url, connection.apiUrl);
    const instance = await this.appTokens.appInstance();
    const host = `${url.host}${url.transport === 'https' && url.port ? `:${url.port}` : ''}`.toLowerCase();

    // The installation token only goes to the cluster's GitHub (its API and Git host), never to another host a
    // connection names (L6).
    if (!instance || !sameApiBase(apiBase, instance.apiBase) || !instance.hosts.includes(host)) return null;

    return await this.appTokens.installationToken(repoSlug(url));
  }

  /** How git reaches the repository: token header for HTTPS, deploy key + pinned host key for SSH. */
  async remote(connection: GitConnectionEntity): Promise<GitRemote> {
    const url = parseRepoUrl(connection.repoUrl);
    const creds = await this.readCredentials(connection);
    let auth: GitAuth = { kind: 'none' };

    if (url.transport === 'ssh') {
      if (!creds.sshPrivateKey) throw new BadRequestException('the connection has no SSH private key');

      auth = { kind: 'ssh', privateKey: creds.sshPrivateKey };
    } else {
      const token = creds.token ?? (await this.appToken(connection));

      if (token) auth = { kind: 'token', username: creds.username ?? TOKEN_USERS[connection.provider], token };
    }

    return { url: connection.repoUrl, auth, knownHosts: connection.hostKey, caCertificate: connection.caCertificate };
  }

  /** The provider API context (statuses, pull requests, the plan bot); the token comes from the same secret. */
  async providerContext(connection: GitConnectionEntity): Promise<GitProviderContext | null> {
    const url = parseRepoUrl(connection.repoUrl);
    const apiBase = providerApiBase(connection.provider, url, connection.apiUrl);

    if (!apiBase) return null;

    const creds = await this.readCredentials(connection);
    const token = creds.token ?? (await this.appToken(connection));

    return { apiBase, repo: repoSlug(url), token, caCertificate: connection.caCertificate };
  }

  /** Projects with their own connection (the cluster connection doesn't carry them). */
  async ownConnections(): Promise<Set<string>> {
    return new Set(
      (await this.dataSource.getRepository(GitConnectionEntity).find()).flatMap((c) => (c.project ? [c.project] : [])),
    );
  }
}
