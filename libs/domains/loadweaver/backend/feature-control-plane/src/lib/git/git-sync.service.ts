import type { RequestWithUser } from '@forepath/identity/backend';
import type { Resource, ResourceKind } from '@forepath/loadweaver/shared/util-model';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { stringify } from 'yaml';
import { DataSource, EntityManager, In, MoreThan } from 'typeorm';

import { ProjectAccessService } from '../access/project-access.service';
import type { GitExportResultDto, GitSyncResultDto } from '../dto/git.dto';
import {
  GitAccountEntity,
  GitCommitEntity,
  GitConnectionEntity,
  GitResourceStateEntity,
  GitWebhookDeliveryEntity,
  type GitCommitKind,
  type GitCommitState,
} from '../entities/git.entity';
import { PlanEntity, type PlanPullRequest, type PlanResourceChange, type PlanSource } from '../entities/plan.entity';
import { PlanApprovalEntity } from '../entities/project-access.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { actorFromRequest, AuditLogService, type AuditActor } from '../services/audit-log.service';
import { ChangeEventsService, type AccessScopesChanged } from '../services/change-events.service';
import { PlansService } from '../services/plans.service';
import { entityToResource, normalizeResource } from '../services/resource-store.service';
import { lockTable, releaseLocks } from '../plans/apply-operation.service';
import {
  GitClient,
  GitError,
  gitIdentityFromEnv,
  sweepStaleTempDirs,
  type GitRemote,
  type GitWorkTree,
} from './git-client';
import { GitConnectionsService } from './git-connections.service';
import { GitLeases, gitConcurrency, Semaphore } from './git-locks';
import { GitBotConfigService, linkedInstanceApiBase, sameApiBase } from './github-app';
import { GitScopeService, touchedConnections } from './git-scope.service';
import { GitSopsDecryptor, isSopsFile } from './git-sops';
import {
  ACCESS_FILE,
  collectGitResources,
  commitStateOf,
  commitStatusOf,
  consoleBaseUrl,
  diffAgainstCluster,
  inScope,
  limitDiff,
  payloadMatchesRepo,
  planGitTitle,
  pushSender,
  replaceResourceDocument,
  resourceKey,
  verifyWebhook,
  webhookDeliveryId,
  webhookEvent,
  webhookEventName,
  type ClusterRow,
  type ConnectionScope,
} from './git-sync.utils';
import { defaultResourcePath, parseRepoUrl, providerApiBase, repoSlug, underPath } from './git-url.utils';
import { GitProviderError, providerAdapter } from './providers';
import { describeFindings, scanFiles } from './secret-scan.utils';
import { writesPaused } from '../database-handover/database-target.runtime';

const TICK_MS = 5_000;
/** The commit status context of plans (and the plan bot's own check, excluded from mergeability). */
export const GIT_STATUS_CONTEXT = 'loadweaver/plan';
const YAML_FILE = /\.ya?ml$/i;
/** All resource files of one commit together (each file is capped by the client). */
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
/** Write-backs look at plans applied this recently. */
const WRITE_BACK_WINDOW_MS = 24 * 3_600_000;
/** Unreported statuses are retried this long. */
const REPORT_WINDOW_MS = 7 * 24 * 3_600_000;
/** Handled webhook deliveries / bot comments are remembered this long (replay protection). */
const DELIVERY_RETENTION_MS = 7 * 24 * 3_600_000;
/** Pull requests of authoritative scopes still being opened after this long are retried (a restart lost them). */
const PENDING_PR_RETRY_MS = 5 * 60_000;
const SYSTEM: AuditActor = { type: 'system', id: null };

/** A planned commit: its state, plan, the files of its resources, and resources identical in Git and the cluster. */
export interface PlannedCommit {
  state: 'pending' | 'no-changes' | 'failed' | 'rejected';
  planId: string | null;
  reason?: string;
  paths?: Record<string, string>;
  /** Resources read from SOPS-encrypted files. */
  sopsKeys?: string[];
  unchanged: Omit<GitResourceStateEntity, 'connectionId' | 'commit' | 'updatedAt'>[];
}

/** Pull request and comment deliveries go to the plan bot (3.30), which registers itself. */
export type GitBotWebhookHandler = (
  connection: GitConnectionEntity,
  event: string,
  payload: unknown,
) => Promise<{ status: 'queued' | 'ignored'; event: string }>;

/** Writing plaintext secrets to Git is refused (M4): the reason names files, lines and rules, never values. */
export class SecretsInGitError extends ConflictException {}

/** One write to a checkout: the tree, the synced resource states, and reads that are checked again on a retry. */
interface GitEdit {
  tree: GitWorkTree;
  states: Map<string, GitResourceStateEntity>;
  /** Resources read from SOPS files (never written in clear). */
  sopsKeys: Set<string>;
  read: (path: string) => Promise<string | null>;
}

function message(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse() as { message?: unknown; issues?: { message?: string; path?: string }[] };
    const issues = Array.isArray(response?.issues)
      ? response.issues.map((i) => `${i.path ? `${i.path}: ` : ''}${i.message ?? ''}`).join('; ')
      : '';
    const text = typeof response?.message === 'string' ? response.message : error.message;

    return (issues ? `${text}: ${issues}` : text).slice(0, 2000);
  }

  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

/** A fixed, value-free reason for the connection test (never a remote response body). */
function testFailure(error: unknown): string {
  if (error instanceof GitError) {
    const reasons: Record<string, string> = {
      'host-key-changed': 'the SSH host key changed (reset the pinned host key if the change is legitimate)',
      auth: 'authentication failed',
      'not-found': 'the repository or branch was not found',
      rejected: 'the push was rejected',
      timeout: 'the repository did not answer in time',
      failed: 'the repository could not be read',
    };

    return reasons[error.code] ?? reasons['failed'];
  }

  if (error instanceof GitProviderError)
    return error.status ? `the provider API answered HTTP ${error.status}` : 'the provider API could not be reached';

  if (error instanceof HttpException) return message(error);

  return 'the repository could not be reached';
}

/** A resource from a plan change's `after` body. */
function resourceOfChange(change: PlanResourceChange): Resource | null {
  if (!change.after) return null;

  const body = change.after as {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    spec: Record<string, unknown>;
  };

  return normalizeResource({
    apiVersion: 'loadweaver.com/v1',
    kind: change.kind as ResourceKind,
    metadata: {
      name: change.name,
      ...(change.project ? { project: change.project } : {}),
      ...(Object.keys(body.labels ?? {}).length ? { labels: body.labels } : {}),
      ...(Object.keys(body.annotations ?? {}).length ? { annotations: body.annotations } : {}),
    },
    spec: body.spec,
  } as Resource);
}

function changeSummary(changes: readonly PlanResourceChange[]): string {
  return changes
    .slice(0, 50)
    .map((c) => `- ${c.action} ${c.kind} ${c.project ? `${c.project}/` : ''}${c.name}`)
    .join('\n');
}

/**
 * GitOps (3.29): pushes become plans (polling under one replica's advisory lock, webhooks), the commit status follows
 * the plan, plaintext secrets reject a push, conflicts are shown in the plan. Authoritative scopes turn UI / API plans
 * into pull requests; bidirectional scopes get applied changes committed back. Scopes can be exported to their repo,
 * and memberships can live in `access.yaml`.
 */
@Injectable()
export class GitSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(GitSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  /** Overridable for tests. */
  client = new GitClient({ identity: gitIdentityFromEnv() });
  private botHandler: GitBotWebhookHandler | null = null;
  readonly leases: GitLeases;
  /** Git operations of this process at once: each may use a pooled database connection briefly, never across git. */
  private readonly gitSlots = new Semaphore(gitConcurrency());
  /** Pull requests being opened for plans of authoritative scopes (asynchronously, M5). */
  private readonly opening = new Map<string, Promise<void>>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly connections: GitConnectionsService,
    private readonly scopes: GitScopeService,
    private readonly plans: PlansService,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditLogService,
    private readonly events: ChangeEventsService,
    private readonly sops: GitSopsDecryptor,
    private readonly botConfig: GitBotConfigService,
  ) {
    this.leases = new GitLeases(dataSource);
  }

  onApplicationBootstrap(): void {
    this.events.onPlanCreated((plan) => this.planCreated(plan));
    this.events.onPlanStatus(async () => this.kick());
    this.events.onAccessChanged((scopes) => this.accessChanged(scopes));

    // Temp dirs of a killed process (clones) don't pile up.
    void sweepStaleTempDirs()
      .then((n) => (n > 0 ? this.logger.log(`Removed ${n} stale Git temp dir(s)`) : undefined))
      .catch(() => undefined);

    if ((process.env['LOADWEAVER_GIT_SYNC'] ?? 'on') === 'off') return;

    this.timer = setInterval(() => this.kick(), TICK_MS);
  }

  /** Stops the loop and waits (bounded) for a running pass, so it doesn't outlive the database connection. */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;

    if (this.timer) clearInterval(this.timer);

    await Promise.race([
      Promise.allSettled([this.current, ...this.opening.values()]),
      new Promise((r) => setTimeout(r, 15_000)),
    ]);
  }

  /** Resolves when pull requests being opened for plans are done (tests). */
  async pullRequestsOpened(): Promise<void> {
    while (this.opening.size > 0) await Promise.allSettled([...this.opening.values()]);
  }

  /** The plan bot (3.30) takes pull request and comment deliveries. */
  registerBot(handler: GitBotWebhookHandler): void {
    this.botHandler = handler;
  }

  /** Runs a loop pass now (or right after the running one). */
  kick(): void {
    if (this.stopped || writesPaused('Git sync', this.logger)) return;

    if (this.current) {
      this.again = true;

      return;
    }

    this.current = this.tick()
      .catch((error: unknown) => this.logger.warn(`Git sync: ${message(error)}`))
      .finally(() => {
        this.current = null;

        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  /** One pass on the replica holding the loop lease: due / requested syncs, statuses, write-backs. */
  async tick(): Promise<void> {
    await this.leases.ifFree('loop', async () => {
      await this.pollDue();
      await this.reconcile();
    });
  }

  /**
   * Serializes everything that touches one connection's repository, across replicas: a lease (no database connection
   * is held while git runs) and a bounded number of Git operations per process (M5).
   */
  async withConnection<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return await this.leases.withLease(
      `connection:${id}`,
      async () => await this.gitSlots.run(fn),
      () => this.stopped,
    );
  }

  private async pollDue(): Promise<void> {
    const now = Date.now();
    const due = (await this.dataSource.getRepository(GitConnectionEntity).find()).filter(
      (c) =>
        c.syncRequested ||
        (!!c.pollIntervalSeconds && (!c.lastPollAt || c.lastPollAt.getTime() + c.pollIntervalSeconds * 1000 <= now)),
    );

    for (const connection of due) {
      if (this.stopped) return;

      await this.withConnection(connection.id, () => this.sync(connection.id, false));
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------------------------------------------

  /** `POST /git/connections/:id/sync`: syncs the branch head now (also an unchanged head). */
  async syncNow(req: RequestWithUser | undefined, id: string): Promise<GitSyncResultDto> {
    await this.connections.forAdmin(req, id);

    const result = await this.withConnection(id, () => this.sync(id, true));

    this.kick();

    return result;
  }

  /** `POST /git/connections/:id/test`: reaches the repository (`ls-remote`), pins the SSH host key on first contact. */
  async test(
    req: RequestWithUser | undefined,
    id: string,
  ): Promise<{
    ok: boolean;
    head: string | null;
    defaultBranch?: string | null;
    hostKey: string | null;
    error?: string;
  }> {
    const connection = await this.connections.forAdmin(req, id);

    try {
      const remote = await this.connections.remote(connection);
      const { sha, knownHosts } = await this.client.lsRemote(remote, connection.branch);

      if (knownHosts) await this.pinHostKey(connection, knownHosts);

      const adapter = providerAdapter(connection.provider);
      const ctx = adapter.hasApi ? await this.connections.providerContext(connection) : null;
      let defaultBranch: string | null | undefined;

      if (ctx?.token) defaultBranch = await adapter.getDefaultBranch(ctx);

      await this.dataSource.getRepository(GitConnectionEntity).update({ id }, { lastError: null });

      return {
        ok: true,
        head: sha,
        ...(defaultBranch !== undefined ? { defaultBranch } : {}),
        hostKey: knownHosts ?? connection.hostKey,
      };
    } catch (error) {
      // Fixed messages (and the status code): remote response bodies are never reflected (L6).
      this.logger.warn(`Connection test of ${id}: ${message(error)}`);

      return { ok: false, head: null, hostKey: connection.hostKey, error: testFailure(error) };
    }
  }

  /** `POST /git/webhooks/:connection`: a signed push to the connection's branch queues a sync. */
  async webhook(
    id: string,
    headers: Record<string, string | string[] | undefined>,
    body: Buffer,
  ): Promise<{ status: 'queued' | 'ignored'; event: string }> {
    const connection = await this.connections.find(id);
    // Same work for unknown connections: nothing tells them apart from a wrong signature.
    const secret = this.connections.webhookSecretOf(
      connection ?? { id: '00000000-0000-0000-0000-000000000000', webhookSalt: null },
    );

    if (!connection || !verifyWebhook(headers, body, secret))
      throw new UnauthorizedException('invalid webhook signature');

    if (!connection.webhook) throw new ForbiddenException('webhooks are disabled for this connection');

    let payload: unknown = null;

    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      payload = null;
    }

    const event = webhookEvent(headers, payload);

    if (event.kind === 'ping') return { status: 'ignored', event: event.kind };

    // Deliveries about another repository (the secret reused elsewhere, a misconfigured hook) are ignored (L4).
    if (!payloadMatchesRepo(connection.provider, payload, repoSlug(parseRepoUrl(connection.repoUrl)))) {
      this.logger.warn(`Webhook for connection ${id} names another repository; ignored`);

      return { status: 'ignored', event: event.kind };
    }

    // A delivery is handled once: replays of a captured delivery are ignored (H1).
    const delivery = webhookDeliveryId(headers);

    if (delivery && !(await this.firstDelivery(id, `delivery:${delivery}`)))
      return { status: 'ignored', event: event.kind };

    // Pull / merge requests and comments belong to the plan bot (3.30).
    if (event.kind !== 'push') {
      if (this.botHandler) return await this.botHandler(connection, webhookEventName(headers), payload);

      return { status: 'ignored', event: event.kind };
    }

    if (event.branch !== null && event.branch !== connection.branch) return { status: 'ignored', event: event.kind };

    await this.dataSource
      .getRepository(GitConnectionEntity)
      .update({ id }, { syncRequested: true, pushAuthors: await this.pushAuthors(connection, payload) });
    this.kick();

    return { status: 'queued', event: 'push' };
  }

  /**
   * Records a delivery / comment key; false if it was handled before (replay). Old keys are dropped now and then, so
   * the table stays bounded (7 days).
   */
  async firstDelivery(connectionId: string, key: string): Promise<boolean> {
    const rows: unknown = await this.dataSource.query(
      `INSERT INTO "lw_git_webhook_deliveries" ("connection_id", "key") VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING "key"`,
      [connectionId, key.slice(0, 160)],
    );

    if (Math.random() < 0.02)
      await this.dataSource
        .getRepository(GitWebhookDeliveryEntity)
        .createQueryBuilder()
        .delete()
        .where('created_at < :before', { before: new Date(Date.now() - DELIVERY_RETENTION_MS) })
        .execute()
        .catch(() => undefined);

    return Array.isArray(rows) && rows.length > 0;
  }

  /**
   * Whether the connection's provider API is the instance Git accounts are linked on (3.30): provider user ids from
   * another GitHub / GitLab instance don't identify anyone here.
   */
  async linkedInstance(connection: GitConnectionEntity): Promise<boolean> {
    if (connection.provider !== 'github' && connection.provider !== 'gitlab') return false;

    try {
      const apiBase = providerApiBase(connection.provider, parseRepoUrl(connection.repoUrl), connection.apiUrl);

      return sameApiBase(apiBase, linkedInstanceApiBase(connection.provider, await this.botConfig.config()));
    } catch {
      return false;
    }
  }

  /** Linked Loadweaver users of the push's sender (hints that only exclude them from approving, never grant). */
  private async pushAuthors(
    connection: GitConnectionEntity,
    payload: unknown,
  ): Promise<{ sha: string | null; users: string[] } | null> {
    const { userIds, after } = pushSender(payload);

    if (userIds.length === 0 || !(await this.linkedInstance(connection))) return null;

    const accounts = await this.dataSource.getRepository(GitAccountEntity).find({
      where: { provider: connection.provider as 'github' | 'gitlab', providerUserId: In(userIds) },
    });

    return accounts.length > 0 ? { sha: after, users: accounts.map((a) => a.userId) } : null;
  }

  /**
   * `POST /git/connections/:id/export`: one commit with the scope's current state (how UI-built setups move to Git).
   * A path that already has YAML files is only overwritten with `force`.
   */
  async exportToRepo(req: RequestWithUser | undefined, id: string, force: boolean): Promise<GitExportResultDto> {
    const connection = await this.connections.forAdmin(req, id);
    const actor = actorFromRequest(req);

    return await this.withConnection(id, async () => {
      const tree = await this.client.open(await this.remoteOf(connection), connection.branch, { allowMissing: true });

      try {
        if (tree.learnedHostKeys) await this.pinHostKey(connection, tree.learnedHostKeys);

        const existing = (await tree.listFiles(connection.path)).filter((f) => YAML_FILE.test(f));

        if (existing.length > 0 && !force)
          throw new ConflictException(
            `${connection.path || 'the repository root'} already has ${existing.length} YAML file(s); export with force: true to replace them`,
          );

        // SOPS-encrypted files are never deleted or overwritten by an export (M4).
        const sopsFiles = new Set<string>();

        for (const file of existing) {
          if (isSopsFile((await tree.readFile(file)).toString('utf8'))) sopsFiles.add(file);
          else await tree.removeFile(file);
        }

        const scope = await this.scopeOf(connection);
        const rows = (
          await this.dataSource.getRepository(ResourceEntity).find({ order: { kind: 'ASC', name: 'ASC' } })
        ).filter((r) => inScope(r, scope));
        const previous = await this.dataSource
          .getRepository(GitResourceStateEntity)
          .find({ where: { connectionId: id } });
        const sopsKeys = await this.sopsOrigin(id, previous);
        const states: Omit<GitResourceStateEntity, 'updatedAt' | 'commit'>[] = [];
        const skipped: string[] = [];

        for (const row of rows) {
          const key = resourceKey(row.kind, row.project, row.name);
          const synced = previous.find(
            (s) => s.kind === row.kind && s.projectKey === row.projectKey && s.name === row.name,
          );

          // Resources that came from SOPS files are never exported in clear: their files stay as they are.
          if (sopsKeys.has(key)) {
            skipped.push(key);

            if (synced)
              states.push({
                connectionId: id,
                kind: synced.kind,
                projectKey: synced.projectKey,
                name: synced.name,
                path: synced.path,
                generation: synced.generation,
                sops: true,
              });

            continue;
          }

          const path = defaultResourcePath(connection.path, row.kind, row.name, row.project);

          if (sopsFiles.has(path)) {
            skipped.push(key);
            continue;
          }

          const text = replaceResourceDocument(
            (await tree.exists(path)) ? (await tree.readFile(path)).toString('utf8') : '',
            key,
            entityToResource(row),
          );

          await tree.writeFile(path, text ?? '');
          states.push({
            connectionId: id,
            kind: row.kind,
            projectKey: row.projectKey,
            name: row.name,
            path,
            generation: row.generation,
            sops: false,
          });
        }

        if (connection.membershipsFromGit)
          await tree.writeFile(this.accessPath(connection), await this.accessYaml(connection, scope));

        await this.assertNoSecrets(connection, tree, 'export', actor);

        const parent = (await tree.head())?.sha ?? null;
        const sha = await tree.commit(
          `Loadweaver export of ${connection.project ? `project ${connection.project}` : 'the cluster scope'} by ${actor.person ?? actor.id ?? actor.type}`,
        );

        if (sha) await tree.push();

        const commit = sha ?? parent;

        await this.dataSource.transaction(async (manager) => {
          if (commit) {
            await this.saveCommit(manager, connection, {
              sha: commit,
              kind: 'export',
              state: 'synced',
              author: actor.person ?? actor.id ?? actor.type,
              message: 'export',
            });
            await manager.getRepository(GitResourceStateEntity).delete({ connectionId: id });
            await manager
              .getRepository(GitResourceStateEntity)
              .save(states.map((s) => manager.getRepository(GitResourceStateEntity).create({ ...s, commit })));
          }

          await manager
            .getRepository(GitConnectionEntity)
            .update({ id }, { lastSyncedCommit: commit, lastSyncAt: new Date(), lastError: null });
          await this.audit.record(manager, {
            actor,
            action: 'git.export',
            target: `git/connection/${id}`,
            project: connection.project,
            details: {
              commit,
              resources: rows.length - skipped.length,
              force,
              changed: !!sha,
              ...(skipped.length > 0 ? { skipped } : {}),
            },
          });
        });

        return { commit, resources: rows.length - skipped.length, changed: !!sha, skipped };
      } finally {
        await tree.dispose();
      }
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------------------------------------------

  private async remoteOf(connection: GitConnectionEntity): Promise<GitRemote> {
    return await this.connections.remote(connection);
  }

  private async scopeOf(connection: Pick<GitConnectionEntity, 'project'>): Promise<ConnectionScope> {
    return { project: connection.project, ownConnections: await this.connections.ownConnections() };
  }

  private accessPath(connection: GitConnectionEntity): string {
    return [connection.path, ACCESS_FILE].filter(Boolean).join('/');
  }

  private async accessYaml(connection: GitConnectionEntity, scope: ConnectionScope): Promise<string> {
    const projects =
      connection.project !== null
        ? [connection.project]
        : (await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'Project' } }))
            .map((p) => p.name)
            .filter((p) => !scope.ownConnections.has(p));

    return stringify(await this.access.accessDocument({ clusterMembers: connection.project === null, projects }));
  }

  /**
   * Resources that came from SOPS files: marked in the synced state, or read from SOPS files at the newest synced head
   * (before its plan's state was recorded).
   */
  private async sopsOrigin(connectionId: string, states?: readonly GitResourceStateEntity[]): Promise<Set<string>> {
    const rows =
      states ?? (await this.dataSource.getRepository(GitResourceStateEntity).find({ where: { connectionId } }));
    const head = await this.dataSource
      .getRepository(GitCommitEntity)
      .findOne({ where: { connectionId, kind: 'push' }, order: { createdAt: 'DESC' } });

    return new Set([
      ...rows.filter((r) => r.sops).map((r) => resourceKey(r.kind, r.projectKey || null, r.name)),
      ...(head?.sopsKeys ?? []),
    ]);
  }

  /**
   * Plaintext secrets never go to Git (M4): every file Loadweaver wrote into the tree is scanned before the commit;
   * findings refuse the write (error, audit, and the connection's error in the inbox).
   */
  private async assertNoSecrets(
    connection: GitConnectionEntity,
    tree: GitWorkTree,
    what: string,
    actor: AuditActor = SYSTEM,
  ): Promise<void> {
    const findings = scanFiles(await tree.writtenFiles());

    if (findings.length === 0) return;

    const reason = `${what} refused: ${describeFindings(findings)}`;

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(GitConnectionEntity)
        .update({ id: connection.id }, { lastError: reason.slice(0, 2000) });
      await this.audit.record(manager, {
        actor,
        action: 'git.write-refused',
        target: `git/connection/${connection.id}`,
        project: connection.project,
        details: { what, reason: reason.slice(0, 1000) },
      });
    });

    throw new SecretsInGitError(reason);
  }

  /** Trust on first use: the host keys seen on first contact are pinned on the connection. */
  async pinHostKey(connection: GitConnectionEntity, knownHosts: string): Promise<void> {
    if (connection.hostKey) return;

    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .getRepository(GitConnectionEntity)
        .createQueryBuilder()
        .update()
        .set({ hostKey: knownHosts })
        .where('id = :id AND host_key IS NULL', { id: connection.id })
        .execute();

      if (result.affected)
        await this.audit.record(manager, {
          actor: SYSTEM,
          action: 'git.connection.host-key-pinned',
          target: `git/connection/${connection.id}`,
          project: connection.project,
          details: { hostKey: knownHosts },
        });
    });
    connection.hostKey = knownHosts;
  }

  /** Syncs a connection's branch head (inside the connection lock). */
  async sync(id: string, force: boolean): Promise<GitSyncResultDto> {
    const repo = this.dataSource.getRepository(GitConnectionEntity);
    const connection = await repo.findOne({ where: { id } });

    if (!connection) return { commit: null, state: 'error', planId: null, reason: 'connection not found' };

    await repo.update({ id }, { lastPollAt: new Date(), syncRequested: false });

    try {
      const remote = await this.remoteOf(connection);
      const head = await this.client.lsRemote(remote, connection.branch);

      if (head.knownHosts) {
        await this.pinHostKey(connection, head.knownHosts);
        remote.knownHosts = head.knownHosts;
      }

      if (!head.sha) throw new GitError('not-found', `branch ${connection.branch} does not exist`);

      if (!force && head.sha === connection.lastSyncedCommit) {
        if (connection.lastError) await repo.update({ id }, { lastError: null });

        return { commit: head.sha, state: 'unchanged', planId: null, reason: null };
      }

      const tree = await this.client.open(remote, connection.branch);

      try {
        return await this.syncTree(connection, tree);
      } finally {
        await tree.dispose();
      }
    } catch (error) {
      const reason = message(error);

      await repo.update({ id }, { lastError: reason });
      this.logger.warn(`Git sync of connection ${id}: ${reason}`);

      return { commit: null, state: 'error', planId: null, reason };
    }
  }

  private async syncTree(connection: GitConnectionEntity, tree: GitWorkTree): Promise<GitSyncResultDto> {
    const head = await tree.head();

    if (!head) throw new GitError('not-found', `branch ${connection.branch} has no commits`);

    const author = `${head.authorName} <${head.authorEmail}>`.slice(0, 255);
    const commit = { sha: head.sha, kind: 'push' as const, author, message: head.subject.slice(0, 200) };
    // Who pushed this head (webhook hint): they can't approve its plan (H2).
    const fresh = await this.dataSource.getRepository(GitConnectionEntity).findOne({ where: { id: connection.id } });
    const hint = fresh?.pushAuthors;
    const authors = hint && (hint.sha === null || hint.sha === head.sha) ? hint.users : [];
    const planned = await this.planTree(connection, tree, {
      source: {
        kind: 'git',
        connection: connection.id,
        commit: head.sha,
        ref: `refs/heads/${connection.branch}`,
        author,
        ...(authors.length > 0 ? { authors } : {}),
      },
      importAccess: true,
    });

    try {
      return await this.finishSync(
        connection,
        {
          ...commit,
          state: planned.state,
          planId: planned.planId,
          ...(planned.reason ? { reason: planned.reason } : {}),
          ...(planned.paths ? { paths: planned.paths } : {}),
          ...(planned.sopsKeys ? { sopsKeys: planned.sopsKeys } : {}),
        },
        planned.unchanged,
      );
    } catch (error) {
      // The commit couldn't be recorded (the connection was deleted meanwhile, ...): its plan doesn't stay behind (L8).
      if (planned.planId) await this.discardOrphan(planned.planId);

      throw error;
    }
  }

  /** Discards a pending plan whose Git commit couldn't be recorded, and releases its locks. */
  async discardOrphan(planId: string): Promise<void> {
    const discarded = await this.dataSource
      .transaction(async (manager) => {
        await lockTable(manager);
        await releaseLocks(manager, planId);

        return (
          (await manager.getRepository(PlanEntity).update({ id: planId, status: 'pending' }, { status: 'discarded' }))
            .affected ?? 0
        );
      })
      .catch(() => 0);

    if (discarded) this.events.planStatus(planId, 'discarded');
  }

  /**
   * Plans a checked-out commit against the cluster (3.29): resource files below the path, secret scan, SOPS, validation,
   * scope rule, `access.yaml` (default branch only), diff with conflicts, plan with `source`. Shared by the branch sync
   * and the plan bot's pull request heads (3.30); `limit` plans only one project or path (`loadweaver plan <x>`).
   */
  async planTree(
    connection: GitConnectionEntity,
    tree: GitWorkTree,
    options: { source: PlanSource; importAccess: boolean; limit?: { project?: string; path?: string } },
  ): Promise<PlannedCommit> {
    const accessPath = this.accessPath(connection);
    const files: { path: string; text: string }[] = [];
    const failed = (state: 'failed' | 'rejected', reason: string, paths?: Record<string, string>): PlannedCommit => ({
      state,
      planId: null,
      reason,
      ...(paths ? { paths } : {}),
      unchanged: [],
    });
    let total = 0;

    for (const path of (await tree.listFiles(connection.path)).filter(
      (f) => YAML_FILE.test(f) && underPath(f, connection.path),
    )) {
      const text = (await tree.readFile(path)).toString('utf8');

      total += Buffer.byteLength(text);

      if (total > MAX_TOTAL_BYTES) return failed('failed', `the resource files exceed ${MAX_TOTAL_BYTES} bytes`);

      files.push({ path, text });
    }

    // Plaintext secrets reject the push: no plan, a failed status, audit and inbox (3.29).
    const findings = scanFiles(files);

    if (findings.length > 0) return failed('rejected', describeFindings(findings));

    const resourceFiles: { path: string; text: string }[] = [];
    const sopsPaths = new Set<string>();

    for (const file of files.filter((f) => f.path !== accessPath)) {
      if (!isSopsFile(file.text)) {
        resourceFiles.push(file);
        continue;
      }

      if (!connection.sops)
        return failed('failed', `${file.path} is SOPS-encrypted, but SOPS is not enabled on this connection`);

      try {
        resourceFiles.push({ path: file.path, text: await this.sops.decrypt(file.path, file.text) });
        sopsPaths.add(file.path);
      } catch (error) {
        return failed('failed', message(error));
      }
    }

    if (resourceFiles.length === 0)
      return failed(
        'failed',
        `no resource files below ${connection.path || 'the repository root'}: a connected scope's Git content is complete, so this would delete everything; export the scope first (POST /git/connections/${connection.id}/export)`,
      );

    const collected = collectGitResources(resourceFiles);

    if (collected.issues.length > 0) return failed('failed', collected.issues.slice(0, 20).join('; '));

    const scope = await this.scopeOf(connection);
    const outside = collected.resources.filter((r) => !inScope({ project: r.resource.metadata.project }, scope));

    if (outside.length > 0)
      return failed(
        'failed',
        `outside this connection's scope (${connection.project ? `project ${connection.project}` : 'cluster'}): ${outside
          .slice(0, 20)
          .map(
            (r) =>
              `${resourceKey(r.resource.kind, r.resource.metadata.project, r.resource.metadata.name)} in ${r.path}`,
          )
          .join(', ')}`,
      );

    // Memberships from Git (direct-API semantics): imported before the plan, a broken document fails the sync.
    const accessFile = files.find((f) => f.path === accessPath);

    if (options.importAccess && connection.membershipsFromGit && accessFile) {
      try {
        const projects =
          connection.project !== null
            ? []
            : (await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'Project' } }))
                .map((p) => p.name)
                .filter((p) => !scope.ownConnections.has(p));

        await this.access.importFromGit(accessFile.text, { project: connection.project, projects }, SYSTEM, {
          source: 'git',
          connection: connection.id,
          commit: options.source.commit ?? '',
        });
      } catch (error) {
        return failed('failed', `${accessPath}: ${message(error)}`);
      }
    }

    const rows: ClusterRow[] = (await this.dataSource.getRepository(ResourceEntity).find())
      .filter((r) => inScope(r, scope))
      .map((r) => ({
        kind: r.kind,
        name: r.name,
        project: r.project,
        generation: r.generation,
        body: { labels: r.labels ?? {}, annotations: r.annotations ?? {}, spec: r.spec },
      }));
    const states = await this.dataSource
      .getRepository(GitResourceStateEntity)
      .find({ where: { connectionId: connection.id } });
    const diff = limitDiff(diffAgainstCluster(collected.resources, rows, states), states, options.limit);
    const paths = Object.fromEntries(
      collected.resources.map((r) => [
        resourceKey(r.resource.kind, r.resource.metadata.project, r.resource.metadata.name),
        r.path,
      ]),
    );
    const sopsKeys = Object.entries(paths)
      .filter(([, path]) => sopsPaths.has(path))
      .map(([key]) => key);
    let planId: string | null = null;

    if (diff.changed.length > 0 || diff.deletions.length > 0) {
      try {
        planId = (
          await this.plans.createFromGit({
            submitted: diff.changed.map((r) => r.resource),
            deletions: diff.deletions.map((d) => ({
              kind: d.kind,
              name: d.name,
              ...(d.project ? { project: d.project } : {}),
            })),
            warnings: diff.conflicts,
            source: options.source,
          })
        ).id;
      } catch (error) {
        return failed('failed', message(error), paths);
      }
    }

    return {
      state: planId ? 'pending' : 'no-changes',
      planId,
      paths,
      sopsKeys,
      unchanged: diff.unchanged.map((r) => {
        const row = rows.find(
          (x) =>
            x.kind === r.resource.kind &&
            x.name === r.resource.metadata.name &&
            x.project === (r.resource.metadata.project ?? null),
        );

        return {
          kind: r.resource.kind,
          projectKey: r.resource.metadata.project ?? '',
          name: r.resource.metadata.name,
          path: r.path,
          generation: row?.generation ?? 0,
          sops: sopsPaths.has(r.path),
        };
      }),
    };
  }

  /** Records the synced head (with its plan / rejection), resource states of unchanged resources, audit, status. */
  private async finishSync(
    connection: GitConnectionEntity,
    commit: {
      sha: string;
      kind: GitCommitKind;
      author: string;
      message: string;
      state: GitCommitState;
      planId?: string | null;
      reason?: string;
      paths?: Record<string, string>;
      sopsKeys?: string[];
    },
    unchanged: Omit<GitResourceStateEntity, 'connectionId' | 'commit' | 'updatedAt'>[] = [],
  ): Promise<GitSyncResultDto> {
    const row = await this.dataSource.transaction(async (manager) => {
      const saved = await this.saveCommit(manager, connection, commit);
      const stateRepo = manager.getRepository(GitResourceStateEntity);

      if (unchanged.length > 0)
        await stateRepo.save(
          unchanged.map((s) => stateRepo.create({ ...s, connectionId: connection.id, commit: commit.sha })),
        );

      await manager
        .getRepository(GitConnectionEntity)
        .update({ id: connection.id }, { lastSyncedCommit: commit.sha, lastSyncAt: new Date(), lastError: null });
      await this.audit.record(manager, {
        actor: SYSTEM,
        action: commit.state === 'rejected' ? 'git.push-rejected' : 'git.sync',
        target: `git/connection/${connection.id}`,
        project: connection.project,
        details: {
          commit: commit.sha,
          author: commit.author,
          state: commit.state,
          ...(commit.planId ? { plan: commit.planId } : {}),
          ...(commit.reason ? { reason: commit.reason } : {}),
        },
      });

      return saved;
    });

    await this.report(connection, row);

    return { commit: commit.sha, state: commit.state, planId: commit.planId ?? null, reason: commit.reason ?? null };
  }

  async saveCommit(
    manager: EntityManager,
    connection: GitConnectionEntity,
    commit: {
      sha: string;
      kind: GitCommitKind;
      author?: string | null;
      message?: string | null;
      state: GitCommitState;
      planId?: string | null;
      reason?: string | null;
      paths?: Record<string, string>;
      sopsKeys?: string[];
      prUrl?: string | null;
      prNumber?: number | null;
      ref?: string;
    },
  ): Promise<GitCommitEntity> {
    const repo = manager.getRepository(GitCommitEntity);
    // Only pushes and pull request heads report a status; what Loadweaver wrote itself is already in sync.
    const reported = commit.kind === 'push' || commit.kind === 'pull-request' ? null : commit.state;

    return await repo.save(
      repo.create({
        connectionId: connection.id,
        sha: commit.sha,
        ref: commit.ref ?? `refs/heads/${connection.branch}`,
        kind: commit.kind,
        planId: commit.planId ?? null,
        author: commit.author ?? null,
        message: commit.message ?? null,
        state: commit.state,
        reportedState: reported,
        reason: commit.reason ?? null,
        paths: commit.paths ?? {},
        sopsKeys: commit.sopsKeys ?? [],
        prUrl: commit.prUrl ?? null,
        prNumber: commit.prNumber ?? null,
      }),
    );
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Statuses, applied Git plans, write-back
  // ---------------------------------------------------------------------------------------------------------------

  /** Commit states follow their plans; unreported statuses are reported; applied changes are written back. */
  async reconcile(): Promise<void> {
    const commitRepo = this.dataSource.getRepository(GitCommitEntity);
    const open = await commitRepo.find({
      where: { kind: In(['push', 'pull-request']), state: In(['pending', 'approved', 'applying']) },
      take: 200,
    });
    const plans = open.length
      ? await this.dataSource
          .getRepository(PlanEntity)
          .find({ where: { id: In(open.flatMap((c) => (c.planId ? [c.planId] : []))) } })
      : [];

    for (const row of open) {
      const plan = plans.find((p) => p.id === row.planId);

      if (plan) await this.followPlan(row, plan);
    }

    const unreported = await commitRepo
      .createQueryBuilder('c')
      .where('c.kind IN (:...kinds)', { kinds: ['push', 'pull-request'] })
      .andWhere('c.reported_state IS DISTINCT FROM c.state')
      .andWhere('c.created_at > :since', { since: new Date(Date.now() - REPORT_WINDOW_MS) })
      .orderBy('c.created_at', 'ASC')
      .take(20)
      .getMany();

    for (const row of unreported) {
      const connection = await this.connections.find(row.connectionId);

      if (connection) await this.report(connection, row);
    }

    await this.writeBacks();
    await this.retryPendingPullRequests();
  }

  /** A commit's state follows its plan (applied: the resources' Git state is recorded); returns the new state. */
  async followPlan(row: GitCommitEntity, plan: PlanEntity): Promise<GitCommitState> {
    const approved =
      plan.status === 'pending' &&
      (await this.dataSource.getRepository(PlanApprovalEntity).count({ where: { planId: plan.id } })) > 0;
    const next = commitStateOf(plan.status, approved);

    if (next === row.state) return next;

    await this.dataSource.transaction(async (manager) => {
      const updated = await manager
        .getRepository(GitCommitEntity)
        .update({ id: row.id, state: row.state }, { state: next });

      // Another pass (or replica) moved it first.
      if (updated.affected && next === 'applied') await this.recordApplied(manager, row, plan);
    });
    row.state = next;

    return next;
  }

  /** After a Git plan applied: the resources' generations match Git now (the base for conflicts and write-back). */
  private async recordApplied(manager: EntityManager, row: GitCommitEntity, plan: PlanEntity): Promise<void> {
    const states = manager.getRepository(GitResourceStateEntity);
    const connection = await manager.getRepository(GitConnectionEntity).findOne({ where: { id: row.connectionId } });

    if (!connection) return;

    for (const change of plan.changes.filter((c) => c.action !== 'unchanged')) {
      const where = {
        connectionId: row.connectionId,
        kind: change.kind,
        projectKey: change.project ?? '',
        name: change.name,
      };

      if (change.action === 'delete') {
        await states.delete(where);
        continue;
      }

      const current = await manager
        .getRepository(ResourceEntity)
        .findOne({ where: { kind: change.kind, name: change.name, projectKey: change.project ?? '' } });

      if (!current) continue;

      const previous = await states.findOne({ where });

      await states.save(
        states.create({
          ...where,
          path:
            row.paths[resourceKey(change.kind, change.project, change.name)] ??
            previous?.path ??
            defaultResourcePath(connection.path, change.kind, change.name, change.project),
          generation: current.generation,
          commit: row.sha,
          sops: (row.sopsKeys ?? []).includes(resourceKey(change.kind, change.project, change.name)),
        }),
      );
    }
  }

  /** Reports the `loadweaver/plan` commit status (plain Git: nothing to report). */
  async report(connection: GitConnectionEntity, row: GitCommitEntity): Promise<void> {
    if ((row.kind !== 'push' && row.kind !== 'pull-request') || row.reportedState === row.state) return;

    const repo = this.dataSource.getRepository(GitCommitEntity);
    const adapter = providerAdapter(connection.provider);

    try {
      const ctx = adapter.hasApi ? await this.connections.providerContext(connection) : null;

      if (ctx?.token) {
        const status = commitStatusOf(row.state, row.planId, row.reason);
        const base = consoleBaseUrl();

        await adapter.setCommitStatus(ctx, {
          sha: row.sha,
          ...status,
          context: GIT_STATUS_CONTEXT,
          ...(base && row.planId ? { targetUrl: `${base}/activity/plans/${row.planId}` } : {}),
        });
      }

      await repo.update({ id: row.id }, { reportedState: row.state });
    } catch (error) {
      this.logger.warn(`Commit status for ${row.sha.slice(0, 12)} (connection ${connection.id}): ${message(error)}`);
      await this.dataSource
        .getRepository(GitConnectionEntity)
        .update({ id: connection.id }, { lastError: `commit status: ${message(error)}` });
    }
  }

  /** Bidirectional scopes: plans applied outside Git are committed back (once per plan and connection). */
  private async writeBacks(): Promise<void> {
    const connections = await this.scopes.connections();
    const bidirectional = connections.filter((c) => c.mode === 'bidirectional');

    if (bidirectional.length === 0) return;

    const since = new Date(Date.now() - WRITE_BACK_WINDOW_MS);
    const applied = (
      await this.dataSource
        .getRepository(PlanEntity)
        .find({ where: { status: 'applied', appliedAt: MoreThan(since) }, order: { appliedAt: 'ASC' }, take: 100 })
    ).filter((p) => p.source?.kind !== 'git');

    for (const plan of applied) {
      for (const connection of touchedConnections(plan.changes, connections)) {
        if (this.stopped) return;

        if (connection.mode !== 'bidirectional' || (plan.appliedAt && plan.appliedAt < connection.createdAt)) continue;

        const done = await this.dataSource
          .getRepository(GitCommitEntity)
          .findOne({ where: { connectionId: connection.id, planId: plan.id, kind: 'commit-back' } });

        if (!done) await this.withConnection(connection.id, () => this.commitBack(connection.id, plan));
      }
    }
  }

  /** Commits the applied state of a plan's resources back to the branch (message with plan id and author). */
  private async commitBack(id: string, plan: PlanEntity): Promise<void> {
    const connection = await this.connections.find(id);

    if (!connection) return;

    // Someone else (another replica) may have done it while we waited for the lock.
    if (
      await this.dataSource
        .getRepository(GitCommitEntity)
        .findOne({ where: { connectionId: id, planId: plan.id, kind: 'commit-back' } })
    )
      return;

    const author = plan.source?.author ?? plan.createdBy ?? 'unknown';
    const scope = await this.scopeOf(connection);
    const touched = plan.changes.filter((c) => c.action !== 'unchanged' && inScope(c, scope));

    try {
      const result = await this.writeChanges(connection, connection.branch, async (edit) => {
        const written: Omit<GitResourceStateEntity, 'updatedAt' | 'commit'>[] = [];
        const removed: { kind: string; projectKey: string; name: string }[] = [];

        for (const change of touched) {
          const current = await this.dataSource
            .getRepository(ResourceEntity)
            .findOne({ where: { kind: change.kind, name: change.name, projectKey: change.project ?? '' } });
          const path = await this.writeResource(
            edit,
            connection,
            change.kind,
            change.name,
            change.project,
            current ? entityToResource(current) : null,
          );

          if (current && path)
            written.push({
              connectionId: id,
              kind: change.kind,
              projectKey: current.projectKey,
              name: change.name,
              path,
              generation: current.generation,
              sops: false,
            });
          else removed.push({ kind: change.kind, projectKey: change.project ?? '', name: change.name });
        }

        return {
          message: `${planGitTitle(plan, author)}\n\n${changeSummary(touched)}`,
          written,
          removed,
        };
      });

      await this.dataSource.transaction(async (manager) => {
        await this.saveCommit(manager, connection, {
          sha: result.commit ?? result.parent ?? '',
          kind: 'commit-back',
          planId: plan.id,
          author,
          message: `Loadweaver plan ${plan.id}`,
          state: 'synced',
        });
        await this.saveStates(manager, id, result.commit ?? result.parent ?? '', result.written, result.removed);

        if (result.commit && result.parent === connection.lastSyncedCommit)
          await manager
            .getRepository(GitConnectionEntity)
            .update({ id }, { lastSyncedCommit: result.commit, lastError: null });

        await this.audit.record(manager, {
          actor: SYSTEM,
          action: 'git.commit-back',
          target: `git/connection/${id}`,
          project: connection.project,
          details: { plan: plan.id, commit: result.commit, author },
        });
      });
    } catch (error) {
      const reason = message(error);

      // Deleted meanwhile: nothing to record.
      if (!(await this.connections.find(id))) return;

      this.logger.warn(`Commit-back of plan ${plan.id} to connection ${id}: ${reason}`);
      await this.dataSource.transaction(async (manager) => {
        await this.saveCommit(manager, connection, {
          sha: '',
          kind: 'commit-back',
          planId: plan.id,
          author,
          state: 'failed',
          reason,
        });
        await manager.getRepository(GitConnectionEntity).update({ id }, { lastError: `commit-back: ${reason}` });
        await this.audit.record(manager, {
          actor: SYSTEM,
          action: 'git.commit-back',
          target: `git/connection/${id}`,
          project: connection.project,
          details: { plan: plan.id, error: reason },
        });
      });
    }
  }

  private async saveStates(
    manager: EntityManager,
    connectionId: string,
    commit: string,
    written: Omit<GitResourceStateEntity, 'updatedAt' | 'commit'>[],
    removed: { kind: string; projectKey: string; name: string }[],
  ): Promise<void> {
    const repo = manager.getRepository(GitResourceStateEntity);

    for (const r of removed) await repo.delete({ connectionId, ...r });

    if (written.length > 0) await repo.save(written.map((w) => repo.create({ ...w, commit })));
  }

  /** Writes one resource into its synced file (or the default path); null resource = remove it. Returns the path. */
  private async writeResource(
    edit: GitEdit,
    connection: GitConnectionEntity,
    kind: string,
    name: string,
    project: string | null,
    resource: Resource | null,
  ): Promise<string | null> {
    const { tree } = edit;
    const key = resourceKey(kind, project, name);
    const state = edit.states.get(key);

    // Resources from SOPS files are never written back in clear (M4).
    if (state?.sops || edit.sopsKeys.has(key))
      throw new ConflictException(
        `${key} comes from a SOPS-encrypted file${state ? ` (${state.path})` : ''}; Loadweaver doesn't write it in clear (change it in Git)`,
      );

    const path = state?.path ?? defaultResourcePath(connection.path, kind, name, project);
    const text = await edit.read(path);

    if (text === null && !resource) return null;

    if (isSopsFile(text))
      throw new ConflictException(`${path} is SOPS-encrypted; Loadweaver doesn't rewrite encrypted files`);

    const next = replaceResourceDocument(text ?? '', key, resource);

    if (next === null) await tree.removeFile(path);
    else await tree.writeFile(path, next);

    return resource ? path : null;
  }

  /**
   * Opens a checkout of `base`, lets `edit` change files, commits and pushes to `target` (the base branch, or a new
   * PR branch). A push rejected because the branch moved is retried once on the new head — unless the files this
   * write touches changed there too: that is a conflict, never overwritten silently (the next sync shows it).
   */
  private async writeChanges<T extends { message: string }>(
    connection: GitConnectionEntity,
    target: string,
    edit: (edit: GitEdit) => Promise<T>,
    base: string = connection.branch,
  ): Promise<T & { commit: string | null; parent: string | null }> {
    const rows = await this.dataSource
      .getRepository(GitResourceStateEntity)
      .find({ where: { connectionId: connection.id } });
    const states = new Map(rows.map((s) => [resourceKey(s.kind, s.projectKey || null, s.name), s]));
    const sopsKeys = await this.sopsOrigin(connection.id, rows);
    /** File contents as first read (null = missing). */
    const seen = new Map<string, string | null>();

    for (let attempt = 0; ; attempt++) {
      const tree = await this.client.open(await this.remoteOf(connection), base, { allowMissing: base === target });

      try {
        if (tree.learnedHostKeys) await this.pinHostKey(connection, tree.learnedHostKeys);

        const parent = (await tree.head())?.sha ?? null;
        const read = async (path: string): Promise<string | null> =>
          (await tree.exists(path)) ? (await tree.readFile(path)).toString('utf8') : null;

        for (const [path, before] of seen)
          if ((await read(path)) !== before)
            throw new ConflictException(
              `${path} changed in Git while Loadweaver was writing it; not overwritten (the next sync shows the conflict)`,
            );

        const result = await edit({
          tree,
          states,
          sopsKeys,
          read: async (path) => {
            const text = await read(path);

            if (!seen.has(path)) seen.set(path, text);

            return text;
          },
        });
        await this.assertNoSecrets(connection, tree, target === base ? 'commit-back' : `pull request branch ${target}`);

        const commit = await tree.commit(result.message);

        if (commit) await tree.push(target);

        return { ...result, commit, parent };
      } catch (error) {
        if (!(error instanceof GitError && error.code === 'rejected' && attempt === 0)) throw error;
      } finally {
        await tree.dispose();
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Authoritative scopes: UI / API plans become pull requests
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * A UI / API plan of authoritative scopes (3.29): its pull requests are marked as being opened right away, and opened
   * in the background (M5: `POST /plans` never waits for clones / pushes); the links follow on the plan.
   */
  private async planCreated(plan: PlanEntity): Promise<void> {
    if (!plan.source || !['ui', 'api', 'drift'].includes(plan.source.kind)) return;

    const authoritative = touchedConnections(plan.changes, await this.scopes.connections()).filter(
      (c) => c.mode === 'authoritative',
    );

    if (authoritative.length === 0) return;

    const pending: PlanPullRequest[] = authoritative.map((c) => ({
      connection: c.id,
      branch: `loadweaver/plan-${plan.id}`,
      pending: true,
    }));

    plan.source = { ...plan.source, pullRequests: pending };
    await this.dataSource.getRepository(PlanEntity).update({ id: plan.id }, { source: plan.source });
    this.openInBackground(plan.id);
  }

  private openInBackground(planId: string): void {
    if (this.stopped || this.opening.has(planId)) return;

    const run = this.openPullRequests(planId)
      .catch((error: unknown) => this.logger.warn(`Pull requests of plan ${planId}: ${message(error)}`))
      .finally(() => this.opening.delete(planId));

    this.opening.set(planId, run);
  }

  /** Opens the pending pull requests of a plan, one connection after another; each result is stored as it comes. */
  private async openPullRequests(planId: string): Promise<void> {
    const plan = await this.dataSource.getRepository(PlanEntity).findOne({ where: { id: planId } });

    if (!plan) return;

    for (const entry of (plan.source?.pullRequests ?? []).filter((p) => p.pending)) {
      const connection = await this.connections.find(entry.connection);
      const result: PlanPullRequest = connection
        ? await this.withConnection(connection.id, () => this.openPullRequest(connection, plan))
        : { connection: entry.connection, branch: entry.branch, error: 'the connection was deleted' };

      // Merged into the current source (the plan may have been superseded meanwhile).
      await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(PlanEntity);
        const current = await repo.findOne({ where: { id: planId }, lock: { mode: 'pessimistic_write' } });

        if (!current?.source) return;

        await repo.update(
          { id: planId },
          {
            source: {
              ...current.source,
              pullRequests: (current.source.pullRequests ?? []).map((p) =>
                p.connection === result.connection ? result : p,
              ),
            },
          },
        );
      });
    }
  }

  /** Pull requests still marked as being opened (a restart lost the background work) are opened again. */
  private async retryPendingPullRequests(): Promise<void> {
    const stale: { id: string }[] = await this.dataSource.query(
      `SELECT "id" FROM "lw_plans" WHERE "status" = 'pending' AND "source" -> 'pullRequests' @> '[{"pending": true}]'::jsonb AND "created_at" < $1 LIMIT 20`,
      [new Date(Date.now() - PENDING_PR_RETRY_MS)],
    );

    for (const { id } of stale) this.openInBackground(id);
  }

  private async openPullRequest(connection: GitConnectionEntity, plan: PlanEntity): Promise<PlanPullRequest> {
    const branch = `loadweaver/plan-${plan.id}`;
    const author = plan.source?.author ?? plan.createdBy ?? 'unknown';
    const scope = await this.scopeOf(connection);
    const touched = plan.changes.filter((c) => c.action !== 'unchanged' && inScope(c, scope));

    try {
      const result = await this.writeChanges(
        connection,
        branch,
        async (edit) => {
          for (const change of touched)
            await this.writeResource(
              edit,
              connection,
              change.kind,
              change.name,
              change.project,
              resourceOfChange(change),
            );

          return { message: `${planGitTitle(plan, author)}\n\n${changeSummary(touched)}` };
        },
        connection.branch,
      );

      if (!result.commit) return { connection: connection.id, branch, error: 'the change matches the branch already' };

      const adapter = providerAdapter(connection.provider);
      const ctx = adapter.hasApi ? await this.connections.providerContext(connection) : null;
      const pr = ctx?.token
        ? await adapter.createPullRequest(ctx, {
            head: branch,
            base: connection.branch,
            title: planGitTitle(plan, author, true).slice(0, 250),
            body: [
              `Proposed in Loadweaver (${plan.source?.kind ?? 'ui'}) as plan \`${plan.id}\`${plan.source?.draft ? ` from Workspace draft \`${plan.source.draft.id}\`` : ''}.`,
              '',
              changeSummary(touched),
              '',
              connection.provider === 'github' || connection.provider === 'gitlab'
                ? 'This scope is managed in Git (authoritative): the Loadweaver plan bot plans this pull request; comment `loadweaver apply` to apply it (merging alone applies nothing).'
                : 'This scope is managed in Git (authoritative): merging this pull request creates a plan from the merge commit, which is then approved and applied in Loadweaver.',
            ].join('\n'),
          })
        : null;

      await this.dataSource.transaction(async (manager) => {
        await this.saveCommit(manager, connection, {
          sha: result.commit as string,
          ref: `refs/heads/${branch}`,
          kind: 'plan-branch',
          planId: plan.id,
          author,
          message: `Loadweaver plan ${plan.id}`,
          state: 'synced',
          prUrl: pr?.url ?? null,
          prNumber: pr?.number ?? null,
        });
        await this.audit.record(manager, {
          actor: SYSTEM,
          action: 'git.pr-opened',
          target: `git/connection/${connection.id}`,
          project: connection.project,
          details: { plan: plan.id, branch, commit: result.commit, ...(pr ? { url: pr.url, number: pr.number } : {}) },
        });
      });

      return { connection: connection.id, branch, ...(pr ? { url: pr.url, number: pr.number } : {}) };
    } catch (error) {
      const reason = message(error);

      await this.audit.recordStandalone({
        actor: SYSTEM,
        action: 'git.pr-opened',
        target: `git/connection/${connection.id}`,
        project: connection.project,
        details: { plan: plan.id, branch, error: reason },
      });

      return { connection: connection.id, branch, error: reason };
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Memberships from Git: direct changes are committed back
  // ---------------------------------------------------------------------------------------------------------------

  private async accessChanged(changed: AccessScopesChanged): Promise<void> {
    const connections = (await this.scopes.connections()).filter((c) => c.membershipsFromGit);

    if (connections.length === 0) return;

    const own = await this.connections.ownConnections();

    for (const connection of connections) {
      const carries =
        connection.project !== null
          ? changed.projects.includes(connection.project)
          : changed.cluster || changed.projects.some((p) => !own.has(p));

      if (carries) await this.withConnection(connection.id, () => this.commitAccess(connection.id));
    }
  }

  private async commitAccess(id: string): Promise<void> {
    const connection = await this.connections.find(id);

    if (!connection?.membershipsFromGit) return;

    try {
      const yaml = await this.accessYaml(connection, await this.scopeOf(connection));
      const result = await this.writeChanges(connection, connection.branch, async (edit) => {
        const path = this.accessPath(connection);

        if ((await edit.read(path)) !== yaml) await edit.tree.writeFile(path, yaml);

        return { message: 'Loadweaver: access changed through the API' };
      });

      if (!result.commit) return;

      await this.dataSource.transaction(async (manager) => {
        await this.saveCommit(manager, connection, {
          sha: result.commit as string,
          kind: 'commit-back',
          author: 'loadweaver',
          message: 'access changed through the API',
          state: 'synced',
        });

        if (result.parent === connection.lastSyncedCommit)
          await manager.getRepository(GitConnectionEntity).update({ id }, { lastSyncedCommit: result.commit });

        await this.audit.record(manager, {
          actor: SYSTEM,
          action: 'git.commit-back',
          target: `git/connection/${id}`,
          project: connection.project,
          details: { file: ACCESS_FILE, commit: result.commit },
        });
      });
    } catch (error) {
      const reason = message(error);

      this.logger.warn(`Access commit-back to connection ${id}: ${reason}`);
      await this.dataSource
        .getRepository(GitConnectionEntity)
        .update({ id }, { lastError: `access commit-back: ${reason}` });
    }
  }
}
