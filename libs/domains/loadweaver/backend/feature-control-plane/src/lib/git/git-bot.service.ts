import type { RequestWithUser } from '@forepath/identity/backend';
import { HttpException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';

import { approvalNeeded, canReadProject, planRequirements } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import {
  GitAccountEntity,
  GitCommitEntity,
  GitConnectionEntity,
  GitPullRequestEntity,
  type GitCommitState,
} from '../entities/git.entity';
import { PlanEntity, type PlanStatus } from '../entities/plan.entity';
import { PlanApprovalEntity, type ProjectRole } from '../entities/project-access.entity';
import { isFleetPerson } from '../fleet-identity/fleet-identity.utils';
import { lockTable, releaseLocks } from '../plans/apply-operation.service';
import { lockConflicts, lockScopes } from '../plans/apply-tracking.utils';
import { AuditLogService, type AuditActor } from '../services/audit-log.service';
import { ChangeEventsService } from '../services/change-events.service';
import { PlansService } from '../services/plans.service';
import { GitConnectionsService } from './git-connections.service';
import { GitScopeService } from './git-scope.service';
import { GIT_STATUS_CONTEXT, GitSyncService, type PlannedCommit } from './git-sync.service';
import { consoleBaseUrl } from './git-sync.utils';
import { renderPlanComment, renderReply, PLAN_COMMENT_MARKER, type CommentPlan } from './plan-comment.utils';
import { BOT_HELP, parseBotCommand, parseBotEvent, type BotEvent } from './plan-bot.utils';
import {
  botAdapter,
  type BotReaction,
  type GitBotProvider,
  type GitProviderContext,
  type PullRequestInfo,
} from './providers';
import { writesPaused } from '../database-handover/database-target.runtime';

const SYSTEM: AuditActor = { type: 'system', id: null };
const RECONCILE_MS = 15_000;
/** Queued events per connection beyond this are dropped (logged); the next push / `loadweaver plan` recovers. */
const MAX_QUEUED = 50;
/** Commands (and replies) per commenter and connection in `REPLY_WINDOW_MS`; more are ignored (L12). */
const REPLY_WINDOW_MS = 10 * 60_000;
/** Commands of unlinked accounts are audited once per login and connection in this window (with a count). */
const UNLINKED_AUDIT_MS = 60 * 60_000;
/** Provider comment times have second precision. */
const COMMENT_CLOCK_SLACK_MS = 1_000;

function replyLimit(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env['LOADWEAVER_GIT_BOT_COMMANDS_PER_10MIN']);

  return Number.isInteger(value) && value >= 1 ? value : 10;
}
const TERMINAL: ReadonlySet<PlanStatus> = new Set(['applied', 'failed', 'rolled-back', 'rollback-failed', 'discarded']);
/** UI / API plans of authoritative scopes are pushed to `loadweaver/plan-<id>` (3.29). */
const PLAN_BRANCH = /^loadweaver\/plan-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function message(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse() as { message?: unknown };

    return typeof response?.message === 'string' ? response.message : error.message;
  }

  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

/** The reasons an HTTP error carries: blockers, locks, plan issues. */
function reasonsOf(error: unknown): string[] {
  if (!(error instanceof HttpException)) return [];

  const response = error.getResponse() as {
    blockers?: unknown;
    locks?: unknown;
    issues?: { message?: string; path?: string }[];
  };

  return [
    ...(Array.isArray(response?.blockers) ? response.blockers.map(String) : []),
    ...(Array.isArray(response?.locks) ? response.locks.map((l) => `locked: ${String(l)}`) : []),
    ...(Array.isArray(response?.issues)
      ? response.issues.map((i) => `${i.path ? `${i.path}: ` : ''}${i.message ?? ''}`)
      : []),
  ].slice(0, 20);
}

/**
 * A request acting as a linked Loadweaver user: their cluster and project memberships apply (3.17). Like PATs, the
 * bot never inherits the global admin role of an interactive login.
 */
export function linkedUserRequest(userId: string): RequestWithUser {
  return { user: { id: userId, roles: [], amr: ['git-bot'] } } as unknown as RequestWithUser;
}

interface Ctx {
  connection: GitConnectionEntity;
  bot: GitBotProvider;
  api: GitProviderContext;
}

/**
 * The plan bot for GitHub and GitLab (3.30): pull / merge requests are planned on open and every push (plan of the
 * head vs. the cluster, locks on the touched resources, one sticky comment, a commit status); comments
 * `loadweaver plan | apply | unlock | approve | drift` by linked accounts with the role for it; an apply needs a
 * mergeable PR and the approval rules, and merges the PR afterwards (configurable). Merging never applies anything.
 */
@Injectable()
export class GitBotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(GitBotService.name);
  private readonly chains = new Map<string, Promise<void>>();
  private readonly queued = new Map<string, number>();
  /** Command times per `connection:commenter` (rate limit). */
  private readonly commands = new Map<string, number[]>();
  /** Unlinked commenters per `connection:login`: last audit and the commands not audited since. */
  private readonly unlinked = new Map<string, { at: number; suppressed: number }>();
  private readonly commandLimit = replyLimit();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly connections: GitConnectionsService,
    private readonly sync: GitSyncService,
    private readonly scopes: GitScopeService,
    private readonly plans: PlansService,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditLogService,
    private readonly events: ChangeEventsService,
  ) {}

  onApplicationBootstrap(): void {
    this.sync.registerBot((connection, event, payload) => this.webhook(connection, event, payload));
    this.events.onPlanStatus(async ({ planId, status }) => this.planStatusChanged(planId, status));

    if ((process.env['LOADWEAVER_GIT_SYNC'] ?? 'on') === 'off') return;

    this.timer = setInterval(() => {
      if (!writesPaused('Git bot', this.logger)) void this.reconcile().catch((e) => this.logger.warn(message(e)));
    }, RECONCILE_MS);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;

    if (this.timer) clearInterval(this.timer);

    await Promise.race([this.idle(), new Promise((r) => setTimeout(r, 15_000))]);
  }

  /** Resolves when every queued event has been handled. */
  async idle(): Promise<void> {
    while (this.chains.size > 0) await Promise.allSettled([...this.chains.values()]);
  }

  /**
   * Events of one connection run one after another (and across replicas under the connection's lease). The queue is
   * bounded: beyond `MAX_QUEUED` events are dropped (logged); the next push or `loadweaver plan` recovers.
   */
  private enqueue(connectionId: string, what: string, fn: () => Promise<void>): boolean {
    if (this.stopped) return false;

    const waiting = this.queued.get(connectionId) ?? 0;

    if (waiting >= MAX_QUEUED) {
      this.logger.warn(`Plan bot: queue of connection ${connectionId} is full; dropped ${what}`);

      return false;
    }

    this.queued.set(connectionId, waiting + 1);

    const previous = this.chains.get(connectionId) ?? Promise.resolve();
    const next = previous
      .then(() => this.sync.withConnection(connectionId, fn))
      .catch((error: unknown) => this.logger.warn(`Plan bot (${what}, connection ${connectionId}): ${message(error)}`))
      .finally(() => {
        const left = (this.queued.get(connectionId) ?? 1) - 1;

        if (left > 0) this.queued.set(connectionId, left);
        else this.queued.delete(connectionId);

        if (this.chains.get(connectionId) === next) this.chains.delete(connectionId);
      });

    this.chains.set(connectionId, next);

    return true;
  }

  /** At most `commandLimit` commands per commenter and connection in 10 minutes (L12). */
  private withinLimit(connectionId: string, commenter: string): boolean {
    const key = `${connectionId}:${commenter}`;
    const now = Date.now();
    const recent = (this.commands.get(key) ?? []).filter((t) => t > now - REPLY_WINDOW_MS);

    if (this.commands.size > 10_000)
      for (const [k, times] of this.commands)
        if (!times.some((t) => t > now - REPLY_WINDOW_MS)) this.commands.delete(k);

    if (recent.length >= this.commandLimit) {
      this.commands.set(key, recent);

      return false;
    }

    this.commands.set(key, [...recent, now]);

    return true;
  }

  /** Commands of unlinked accounts: the first per login and hour is audited (with how many weren't), not every one. */
  private unlinkedAudit(connectionId: string, login: string): { audit: boolean; suppressed: number } {
    const key = `${connectionId}:${login}`;
    const now = Date.now();
    const entry = this.unlinked.get(key);

    if (this.unlinked.size > 10_000)
      for (const [k, e] of this.unlinked) if (e.at < now - UNLINKED_AUDIT_MS) this.unlinked.delete(k);

    if (entry && entry.at > now - UNLINKED_AUDIT_MS) {
      entry.suppressed++;

      return { audit: false, suppressed: entry.suppressed };
    }

    this.unlinked.set(key, { at: now, suppressed: 0 });

    return { audit: true, suppressed: entry?.suppressed ?? 0 };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------------------------------------------

  /** A verified pull request / comment delivery: queued for the bot, or ignored. */
  async webhook(
    connection: GitConnectionEntity,
    event: string,
    payload: unknown,
  ): Promise<{ status: 'queued' | 'ignored'; event: string }> {
    const bot = botAdapter(connection.provider);

    if (!bot || (connection.provider !== 'github' && connection.provider !== 'gitlab'))
      return { status: 'ignored', event: 'pull-request' };

    const parsed = parseBotEvent(connection.provider, event, payload);

    if (!parsed || !Number.isSafeInteger(parsed.number) || parsed.number <= 0)
      return { status: 'ignored', event: 'other' };

    if (parsed.kind === 'pull-request') {
      if (parsed.action === 'other' || (parsed.baseRef !== null && parsed.baseRef !== connection.branch))
        return { status: 'ignored', event: parsed.kind };

      const queued = this.enqueue(connection.id, `pull request ${parsed.number}`, () =>
        this.pullRequestEvent(connection.id, parsed),
      );

      return { status: queued ? 'queued' : 'ignored', event: parsed.kind };
    }

    // The payload only decides whether to look: the comment itself is read from the provider API (H1).
    if (parsed.isBot || !parseBotCommand(parsed.body) || !/^\d{1,20}$/.test(parsed.commentId))
      return { status: 'ignored', event: parsed.kind };

    const queued = this.enqueue(connection.id, `comment on ${parsed.number}`, () =>
      this.comment(connection.id, { number: parsed.number, commentId: parsed.commentId }),
    );

    return { status: queued ? 'queued' : 'ignored', event: parsed.kind };
  }

  private async context(connectionId: string): Promise<Ctx | null> {
    const connection = await this.connections.find(connectionId);
    const bot = connection ? botAdapter(connection.provider) : null;

    if (!connection || !bot) return null;

    const api = await this.connections.providerContext(connection);

    if (!api?.token) {
      await this.dataSource
        .getRepository(GitConnectionEntity)
        .update({ id: connection.id }, { lastError: 'plan bot: no API token (connection credentials or GitHub App)' });

      return null;
    }

    return { connection, bot, api };
  }

  private async pullRequestEvent(
    connectionId: string,
    event: Extract<BotEvent, { kind: 'pull-request' }>,
  ): Promise<void> {
    const ctx = await this.context(connectionId);

    if (!ctx) return;

    if (event.action === 'opened' || event.action === 'updated') {
      await this.planPullRequest(ctx, event.number);

      return;
    }

    await this.closed(ctx, event.number, event.action === 'merged');
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Planning
  // ---------------------------------------------------------------------------------------------------------------

  private async row(ctx: Ctx, info: PullRequestInfo): Promise<GitPullRequestEntity> {
    const repo = this.dataSource.getRepository(GitPullRequestEntity);
    const existing = await repo.findOne({ where: { connectionId: ctx.connection.id, number: info.number } });
    const values = {
      state: info.state,
      title: info.title,
      url: info.url || null,
      author: info.author,
      headRef: info.headRef.slice(0, 255),
    };

    if (existing) {
      Object.assign(existing, values);

      return await repo.save(existing);
    }

    await repo
      .createQueryBuilder()
      .insert()
      .values({ connectionId: ctx.connection.id, number: info.number, headSha: '', ...values })
      .orIgnore()
      .execute();

    return await repo.findOneOrFail({ where: { connectionId: ctx.connection.id, number: info.number } });
  }

  /**
   * Plans the pull request head against the cluster (3.30): the previous plan of the PR is discarded and its locks
   * move to the new plan (all or nothing: resources locked by others stay theirs), the head gets a commit status, the
   * sticky comment is updated. An authoritative UI plan pushed as this PR's branch is superseded by it.
   */
  private async planPullRequest(
    ctx: Ctx,
    number: number,
    options: { limit?: { project?: string; path?: string }; result?: string; allowFork?: boolean } = {},
  ): Promise<void> {
    const { connection, bot, api } = ctx;
    const info = await bot.getPullRequest(api, number);

    if (info.state !== 'open' || info.baseRef !== connection.branch) return;

    // Fork heads are anyone's code: planned (registry lookups, ...) only on `loadweaver plan` by a linked account.
    if (info.fork && !options.allowFork) return await this.forkWaiting(ctx, info);

    const pr = await this.row(ctx, info);
    const ref = bot.pullRequestRef(number);
    let planned: PlannedCommit;
    let sha = info.headSha;
    let author = info.author ?? '';
    // The pull request's author (linked Loadweaver user) can't approve its plan (H2).
    const authors = await this.linkedUsers(ctx, info.authorId ? [info.authorId] : []);
    const limited = options.limit?.project ?? options.limit?.path ?? null;

    try {
      const tree = await this.sync.client.openRef(await this.connections.remote(connection), ref);

      try {
        if (tree.learnedHostKeys) await this.sync.pinHostKey(connection, tree.learnedHostKeys);

        const head = await tree.head();

        sha = head?.sha ?? sha;
        author = head ? `${head.authorName} <${head.authorEmail}>`.slice(0, 255) : author;
        planned = await this.sync.planTree(connection, tree, {
          source: {
            kind: 'git',
            connection: connection.id,
            commit: sha,
            ref,
            pr: number,
            ...(info.url ? { prUrl: info.url } : {}),
            author,
            ...(authors.length > 0 ? { authors } : {}),
            ...(limited ? { limited } : {}),
          },
          importAccess: false,
          ...(options.limit ? { limit: options.limit } : {}),
        });
      } finally {
        await tree.dispose();
      }
    } catch (error) {
      planned = { state: 'failed', planId: null, reason: message(error), unchanged: [] };
    }

    const previous = pr.planId;
    let discarded = false;
    const commit = await this.dataSource
      .transaction(async (manager) => {
        if (previous && previous !== planned.planId) discarded = await this.dropPlan(manager, previous);

        if (planned.planId) {
          const plan = await manager.getRepository(PlanEntity).findOneOrFail({ where: { id: planned.planId } });

          await this.acquireLocks(manager, plan);
        }

        const row = await this.sync.saveCommit(manager, connection, {
          sha,
          ref,
          kind: 'pull-request',
          planId: planned.planId,
          author,
          message: info.title.slice(0, 200),
          state: planned.state,
          reason: planned.reason ?? null,
          ...(planned.paths ? { paths: planned.paths } : {}),
          ...(planned.sopsKeys ? { sopsKeys: planned.sopsKeys } : {}),
          prUrl: info.url || null,
          prNumber: number,
        });

        await manager
          .getRepository(GitPullRequestEntity)
          .update({ id: pr.id }, { planId: planned.planId, headSha: sha, lastError: null });
        await this.audit.record(manager, {
          actor: SYSTEM,
          action: 'git.pr.planned',
          target: `git/connection/${connection.id}`,
          project: connection.project,
          details: {
            pr: number,
            commit: sha,
            state: planned.state,
            ...(planned.planId ? { plan: planned.planId } : {}),
            ...(previous && previous !== planned.planId ? { replaces: previous } : {}),
            ...(options.limit ? { limit: options.limit } : {}),
            ...(planned.reason ? { reason: planned.reason.slice(0, 500) } : {}),
          },
        });

        return row;
      })
      .catch(async (error: unknown) => {
        // Not recorded (the connection was deleted meanwhile, ...): the new plan doesn't stay behind with locks (L8).
        if (planned.planId) await this.sync.discardOrphan(planned.planId);

        throw error;
      });

    if (discarded && previous) this.events.planStatus(previous, 'discarded');

    await this.sync.report(connection, commit);

    // The UI plan this PR was opened for (authoritative mode, 3.29) is replaced by the PR's plan.
    const uiPlan = PLAN_BRANCH.exec(info.headRef)?.[1];

    if (uiPlan && planned.planId)
      await this.plans.supersede(uiPlan, planned.planId, { connection: connection.id, number });

    pr.planId = planned.planId;
    pr.headSha = sha;
    await this.refreshComment(ctx, pr, {
      result: options.result ?? null,
      failure: planned.planId ? null : (planned.reason ?? null),
      limitedTo: options.limit?.project ?? options.limit?.path ?? null,
    });
  }

  /** A fork's new head: the previous plan (of another head) goes, and the comment says how to plan it. */
  private async forkWaiting(ctx: Ctx, info: PullRequestInfo): Promise<void> {
    const pr = await this.row(ctx, info);
    const previous = pr.planId;
    let discarded = false;

    await this.dataSource.transaction(async (manager) => {
      if (previous) discarded = await this.dropPlan(manager, previous);

      await manager
        .getRepository(GitPullRequestEntity)
        .update({ id: pr.id }, { planId: null, headSha: info.headSha.slice(0, 64) });
    });

    if (discarded && previous) this.events.planStatus(previous, 'discarded');

    pr.planId = null;
    pr.headSha = info.headSha;
    await this.refreshComment(ctx, pr, {
      result:
        'This pull request comes from a fork: it is planned when a linked account with the role for it comments `loadweaver plan`.',
    });
  }

  /** Discards a pending PR plan and releases its locks; true if it was discarded now. */
  private async dropPlan(manager: EntityManager, planId: string): Promise<boolean> {
    await lockTable(manager);

    const plan = await manager.getRepository(PlanEntity).findOne({ where: { id: planId } });

    // Applying / failed-rollback plans keep their locks (3.19).
    if (!plan || plan.status !== 'pending') return false;

    await releaseLocks(manager, planId);
    await manager.getRepository(PlanEntity).update({ id: planId, status: 'pending' }, { status: 'discarded' });

    return true;
  }

  /** PR locks (3.8 / 3.30): the plan's resources, all or nothing; held ones are reported in the comment. */
  private async acquireLocks(manager: EntityManager, plan: PlanEntity): Promise<void> {
    await lockTable(manager);

    const scopes = lockScopes(plan.changes);

    if (scopes.length === 0) return;

    const held: { scope: string; plan_id: string }[] = await manager.query(
      'SELECT "scope", "plan_id" FROM "lw_resource_locks"',
    );

    if (
      lockConflicts(
        scopes,
        held.map((l) => ({ scope: l.scope, planId: l.plan_id })),
        plan.id,
      ).length > 0
    )
      return;

    for (const scope of scopes)
      await manager.query(
        `INSERT INTO "lw_resource_locks" ("scope", "plan_id") VALUES ($1, $2) ON CONFLICT ("scope") DO NOTHING`,
        [scope, plan.id],
      );
  }

  /** PR closed or merged: locks released, a pending plan discarded; merged without apply leaves "ahead" drift. */
  private async closed(ctx: Ctx, number: number, merged: boolean): Promise<void> {
    const repo = this.dataSource.getRepository(GitPullRequestEntity);
    const pr = await repo.findOne({ where: { connectionId: ctx.connection.id, number } });

    if (!pr) return;

    const plan = pr.planId
      ? await this.dataSource.getRepository(PlanEntity).findOne({ where: { id: pr.planId } })
      : null;
    const applied = plan?.status === 'applied';
    let discarded = false;

    await this.dataSource.transaction(async (manager) => {
      if (pr.planId) discarded = await this.dropPlan(manager, pr.planId);

      await manager.getRepository(GitPullRequestEntity).update({ id: pr.id }, { state: merged ? 'merged' : 'closed' });
      await this.audit.record(manager, {
        actor: SYSTEM,
        action: merged ? 'git.pr.merged' : 'git.pr.closed',
        target: `git/connection/${ctx.connection.id}`,
        project: ctx.connection.project,
        details: { pr: number, commit: pr.headSha, applied, ...(pr.planId ? { plan: pr.planId } : {}) },
      });
    });

    if (discarded && pr.planId) this.events.planStatus(pr.planId, 'discarded');

    // The default branch moved: sync it now (a merge without apply becomes a pending plan, "ahead" drift).
    if (merged) {
      await this.dataSource
        .getRepository(GitConnectionEntity)
        .update({ id: ctx.connection.id }, { syncRequested: true });
      this.sync.kick();
    }

    pr.state = merged ? 'merged' : 'closed';

    const result = merged
      ? applied
        ? 'Merged after the apply.'
        : 'Merged without `loadweaver apply`: nothing was applied. The default branch is now ahead of the cluster; its plan is pending in the console.'
      : 'Closed: the locks are released and the plan is discarded.';

    await this.refreshComment(ctx, pr, { result });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The sticky comment
  // ---------------------------------------------------------------------------------------------------------------

  private async commentPlan(plan: PlanEntity | null): Promise<CommentPlan | null> {
    return plan
      ? {
          id: plan.id,
          status: plan.status,
          changes: plan.changes,
          networkChanges: plan.networkChanges ?? [],
          workloadChanges: plan.workloadChanges ?? [],
          warnings: plan.warnings ?? [],
          failureAnalysis: plan.failureAnalysis,
          risk: plan.risk ?? {},
          error: plan.error,
        }
      : null;
  }

  /**
   * Who holds a lock: a pull request or plan of this connection; anything else is "another change" without details
   * (the comment is public: other scopes' pull requests and plans aren't named there, L10).
   */
  private async holderOf(ctx: Ctx, planId: string): Promise<string> {
    const plan = await this.dataSource.getRepository(PlanEntity).findOne({ where: { id: planId } });

    if (!plan || plan.source?.kind !== 'git' || plan.source.connection !== ctx.connection.id) return 'another change';

    if (plan.source.pr !== undefined)
      return `pull request #${plan.source.pr}${plan.source.prUrl ? ` (${plan.source.prUrl})` : ''}`;

    return `plan ${planId.slice(0, 8)} (${plan.status})`;
  }

  /** Failed rollbacks for a public comment: this connection's with id and error, others' without details (L10). */
  private ownOrAnonymous(ctx: Ctx, plans: readonly PlanEntity[]): { planId: string | null; error: string | null }[] {
    const own = plans
      .filter((p) => p.source?.kind === 'git' && p.source.connection === ctx.connection.id)
      .map((p) => ({ planId: p.id, error: p.error }));

    return own.length < plans.length ? [...own, { planId: null, error: null }] : own;
  }

  /** Loadweaver users linked to these provider user ids, if the connection is on the linked instance. */
  private async linkedUsers(ctx: Ctx, providerUserIds: readonly string[]): Promise<string[]> {
    const ids = providerUserIds.filter((id) => /^\d{1,20}$/.test(id));

    if (ids.length === 0 || !(await this.sync.linkedInstance(ctx.connection))) return [];

    return (
      await this.dataSource.getRepository(GitAccountEntity).find({
        where: { provider: ctx.connection.provider as 'github' | 'gitlab', providerUserId: In(ids) },
      })
    ).map((a) => a.userId);
  }

  private async approvalsOf(
    plan: PlanEntity,
  ): Promise<{ needed: string[]; given: { project: string; userId: string }[] }> {
    const approvals = await this.dataSource.getRepository(PlanApprovalEntity).find({ where: { planId: plan.id } });
    const needed: string[] = [];

    for (const project of planRequirements(plan.changes).projects) {
      const { approvalMode } = await this.access.settings(this.dataSource.manager, project);

      if (
        approvalNeeded(
          approvalMode,
          plan.creatorRoles?.[project] as ProjectRole | undefined,
          (plan.risk?.[project] ?? []).length > 0,
        ) &&
        !approvals.some((a) => a.project === project)
      )
        needed.push(project);
    }

    return { needed, given: approvals.map((a) => ({ project: a.project, userId: a.userId })) };
  }

  private async refreshComment(
    ctx: Ctx,
    pr: GitPullRequestEntity,
    extra: { result?: string | null; failure?: string | null; limitedTo?: string | null } = {},
  ): Promise<void> {
    const plan = pr.planId
      ? await this.dataSource.getRepository(PlanEntity).findOne({ where: { id: pr.planId } })
      : null;
    const held: { scope: string; plan_id: string }[] = await this.dataSource.query(
      'SELECT "scope", "plan_id" FROM "lw_resource_locks"',
    );
    const locks = held.map((l) => ({ scope: l.scope, planId: l.plan_id }));
    const others = plan && plan.status === 'pending' ? lockConflicts(lockScopes(plan.changes), locks, plan.id) : [];
    const touched = new Set(plan ? lockScopes(plan.changes) : []);
    const inconsistent = (
      await this.dataSource.getRepository(PlanEntity).find({ where: { status: 'rollback-failed' } })
    ).filter((p) => lockScopes(p.changes).some((s) => touched.has(s) || s === 'cluster'));
    let failure = extra.failure ?? null;

    if (!plan && failure === null) {
      const commit = await this.dataSource.getRepository(GitCommitEntity).findOne({
        where: { connectionId: ctx.connection.id, kind: 'pull-request', prNumber: pr.number, sha: pr.headSha },
        order: { createdAt: 'DESC' },
      });

      failure = commit && ['failed', 'rejected'].includes(commit.state) ? commit.reason : null;
    }

    const body = renderPlanComment({
      scope: ctx.connection.project ?? 'cluster',
      headSha: pr.headSha,
      plan: await this.commentPlan(plan),
      failure,
      limitedTo: extra.limitedTo ?? null,
      ...(plan && plan.status === 'pending' ? { approvals: await this.approvalsOf(plan) } : {}),
      locksByOthers: await Promise.all(
        others.map(async (l) => ({ scope: l.scope, holder: await this.holderOf(ctx, l.planId) })),
      ),
      locked: !!plan && locks.some((l) => l.planId === plan.id),
      ahead: (await this.scopes.ahead()).filter((a) => a.connection === ctx.connection.id),
      inconsistent: this.ownOrAnonymous(ctx, inconsistent),
      result: extra.result ?? null,
      consoleUrl: consoleBaseUrl(),
    });

    try {
      // Someone else's comment can carry the marker too: an update that fails falls back to a new comment.
      const update = async (id: string | null): Promise<boolean> =>
        !!id && (await ctx.bot.updateComment(ctx.api, pr.number, id, body).catch(() => false));
      let id = pr.commentId;

      if (!(await update(id))) {
        const found = await ctx.bot.findComment(ctx.api, pr.number, PLAN_COMMENT_MARKER);

        id =
          found && found !== pr.commentId && (await update(found))
            ? found
            : await ctx.bot.createComment(ctx.api, pr.number, body);
      }

      if (id !== pr.commentId) {
        pr.commentId = id;
        await this.dataSource.getRepository(GitPullRequestEntity).update({ id: pr.id }, { commentId: id });
      }
    } catch (error) {
      const reason = `plan comment on #${pr.number}: ${message(error)}`;

      this.logger.warn(reason);
      await this.dataSource.getRepository(GitPullRequestEntity).update({ id: pr.id }, { lastError: reason });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------------------------------------------

  private async react(ctx: Ctx, number: number, commentId: string, reaction: BotReaction): Promise<void> {
    await ctx.bot.react(ctx.api, number, commentId, reaction).catch(() => undefined);
  }

  private async reply(ctx: Ctx, number: number, body: string): Promise<void> {
    await ctx.bot
      .createComment(ctx.api, number, body)
      .catch((error: unknown) => this.logger.warn(`Plan bot reply on #${number}: ${message(error)}`));
  }

  /**
   * A command comment (3.30). Author, body and time come from the provider API (the webhook payload is only a hint,
   * H1); each comment acts once; accounts count only on the instance they were linked on; a comment can only act on
   * the plan that existed when it was written; commands per commenter are rate-limited.
   */
  private async comment(connectionId: string, event: { number: number; commentId: string }): Promise<void> {
    const ctx = await this.context(connectionId);

    if (!ctx) return;

    const comment = await ctx.bot.getComment(ctx.api, event.number, event.commentId);

    if (!comment || comment.isBot) return;

    const command = parseBotCommand(comment.body);

    if (!command) return;

    // Replays (a re-sent delivery, a forged payload naming an old comment) don't act twice.
    if (!(await this.sync.firstDelivery(connectionId, `comment:${comment.id}`))) return;

    if (!this.withinLimit(connectionId, comment.userId || comment.login)) {
      this.logger.warn(`Plan bot: too many commands by ${comment.login} on connection ${connectionId}; ignored`);

      return;
    }

    await this.react(ctx, event.number, comment.id, 'eyes');

    const info = await ctx.bot.getPullRequest(ctx.api, event.number);
    const pr = await this.row(ctx, info);
    const name = command.name === 'invalid' ? 'invalid' : command.name;
    const trusted = await this.sync.linkedInstance(ctx.connection);
    const account =
      trusted && /^\d{1,20}$/.test(comment.userId)
        ? await this.dataSource.getRepository(GitAccountEntity).findOne({
            where: { provider: ctx.connection.provider as 'github' | 'gitlab', providerUserId: comment.userId },
          })
        : null;
    const done = async (outcome: 'done' | 'refused', text: string, reasons: string[] = []) => {
      const unlinked = account ? null : this.unlinkedAudit(connectionId, comment.login);

      if (!unlinked || unlinked.audit)
        await this.audit.recordStandalone({
          actor: account ? { type: 'user', id: account.userId } : SYSTEM,
          action: `git.command.${name}`,
          target: `git/connection/${ctx.connection.id}`,
          project: ctx.connection.project,
          details: {
            pr: event.number,
            commit: info.headSha,
            comment: comment.id,
            login: comment.login,
            user: account?.userId ?? null,
            outcome,
            ...(outcome === 'refused' ? { reason: [text, ...reasons].join('; ').slice(0, 1000) } : {}),
            ...(pr.planId ? { plan: pr.planId } : {}),
            ...(unlinked && unlinked.suppressed > 0 ? { unauditedSince: unlinked.suppressed } : {}),
          },
        });

      await this.reply(ctx, event.number, renderReply(comment.login, name, text, reasons));
      await this.react(ctx, event.number, comment.id, outcome === 'done' ? '+1' : '-1');
    };
    const providerName = ctx.connection.provider === 'github' ? 'GitHub' : 'GitLab';

    if (!trusted)
      return await done(
        'refused',
        `accounts aren't linked for this ${providerName} instance: Loadweaver links ${providerName} accounts on the instance configured in Cluster.spec.git, and this connection uses another one`,
      );

    if (!account)
      return await done(
        'refused',
        `your ${providerName} account is not linked to a Loadweaver user; link it in the console (Settings, Git accounts) first`,
      );

    if (command.name === 'invalid') return await done('refused', command.reason, [BOT_HELP]);

    if (command.name === 'help') return await done('done', 'commands', [BOT_HELP]);

    // Linked through a fleet (3.41): a fleet grant is only known on requests the fleet signs, never here. Commands act
    // with the roles this cluster itself grants the person id (normally none) — never with a grant from a past claim.
    if (isFleetPerson(account.userId)) {
      const own = await this.access.caller(linkedUserRequest(account.userId));

      if (!own.clusterRole && own.projects.size === 0)
        return await done(
          'refused',
          `your ${providerName} account is linked to a fleet user: this cluster grants that person no role of its own, and fleet grants only count on requests the fleet signs; plan, approve and apply through the console`,
        );
    }

    if (info.state !== 'open')
      return await done(
        'refused',
        `the ${info.state === 'merged' ? 'pull request is merged' : 'pull request is closed'}`,
      );

    if (info.baseRef !== ctx.connection.branch)
      return await done(
        'refused',
        `the pull request targets ${info.baseRef}, not the connected branch ${ctx.connection.branch}`,
      );

    /** A comment only acts on the plan that existed when it was written (the plan may have changed since). */
    const olderThan = (plan: PlanEntity | null) =>
      !!plan && comment.createdAt.getTime() + COMMENT_CLOCK_SLACK_MS < plan.createdAt.getTime();
    const staleReason = 'this comment was written before the current plan; comment again to act on the new plan';

    const req = linkedUserRequest(account.userId);
    // Planning and unlocking need the developer role in the scope (cluster scope: infrastructure rights).
    const scopeRights = () =>
      this.plans.mayChange(req, [{ action: 'update', kind: 'Site', project: ctx.connection.project }]);

    switch (command.name) {
      case 'plan': {
        const denied = await scopeRights();

        if (denied) return await done('refused', denied);

        const limit = command.project
          ? { project: command.project }
          : command.path
            ? { path: command.path }
            : undefined;

        await this.planPullRequest(ctx, event.number, {
          ...(limit ? { limit } : {}),
          result: `Re-planned by @${comment.login}.`,
          allowFork: true,
        });

        return await done('done', 'planned again; see the plan comment');
      }

      case 'unlock': {
        const denied = await scopeRights();

        if (denied) return await done('refused', denied);

        const current = pr.planId
          ? await this.dataSource.getRepository(PlanEntity).findOne({ where: { id: pr.planId } })
          : null;

        if (olderThan(current)) return await done('refused', staleReason);

        let discarded = false;

        await this.dataSource.transaction(async (manager) => {
          if (pr.planId) discarded = await this.dropPlan(manager, pr.planId);
        });

        if (discarded && pr.planId) this.events.planStatus(pr.planId, 'discarded');

        await this.refreshComment(ctx, pr, {
          result: `Unlocked by @${comment.login}: locks released, plan discarded.`,
        });

        return await done(
          'done',
          discarded
            ? 'locks released and the plan discarded; comment `loadweaver plan` to plan again'
            : 'nothing was locked',
        );
      }

      case 'drift':
        return await this.drift(ctx, pr, req, done);

      case 'approve':
      case 'apply': {
        const plan = pr.planId
          ? await this.dataSource.getRepository(PlanEntity).findOne({ where: { id: pr.planId } })
          : null;

        if (!plan) return await done('refused', 'this pull request has no plan; comment `loadweaver plan` first');

        if (plan.status !== 'pending') return await done('refused', `the plan is ${plan.status}`);

        if (plan.source?.commit !== info.headSha)
          return await done('refused', 'the pull request changed since it was planned; wait for the new plan');

        if (olderThan(plan)) return await done('refused', staleReason);

        if (command.name === 'approve') {
          try {
            await this.plans.approve(plan.id, req);
          } catch (error) {
            return await done('refused', message(error), reasonsOf(error));
          }

          await this.refreshComment(ctx, pr, { result: `Approved by @${comment.login}.` });

          return await done('done', 'approved');
        }

        return await this.apply(
          ctx,
          pr,
          info,
          plan,
          req,
          command.name === 'apply' && command.confirm,
          comment.login,
          account.userId,
          done,
        );
      }
    }
  }

  private async drift(
    ctx: Ctx,
    pr: GitPullRequestEntity,
    req: RequestWithUser,
    done: (outcome: 'done' | 'refused', text: string, reasons?: string[]) => Promise<void>,
  ): Promise<void> {
    const caller = await this.access.caller(req);
    const project = ctx.connection.project;

    if (project ? !canReadProject(caller, project) : !caller.clusterRole)
      return await done('refused', project ? `project ${project}: no role to read it` : 'no cluster role');

    const ahead = (await this.scopes.ahead()).filter((a) => a.connection === ctx.connection.id);
    const plan = pr.planId
      ? await this.dataSource.getRepository(PlanEntity).findOne({ where: { id: pr.planId } })
      : null;
    const conflicts = (plan?.warnings ?? [])
      .filter((w) => w['path'] === 'git-conflict')
      .map((w) => String(w['message']));
    const failed = (
      await this.dataSource.getRepository(PlanEntity).find({ where: { status: 'rollback-failed' } })
    ).filter((p) => plan && lockScopes(p.changes).some((s) => lockScopes(plan.changes).includes(s)));
    const lines = [
      ...ahead.map(
        (a) =>
          `default branch ahead of cluster: ${a.commit.slice(0, 8)} is ${a.state}${a.planId ? ` (plan ${a.planId.slice(0, 8)})` : ''}${a.reason ? `: ${a.reason}` : ''}`,
      ),
      ...conflicts,
      ...this.ownOrAnonymous(ctx, failed).map((p) =>
        p.planId
          ? `plan ${p.planId.slice(0, 8)} failed to roll back: configuration and reality may differ`
          : 'a change in another scope failed to roll back: configuration and reality may differ',
      ),
    ];

    await done(
      'done',
      lines.length > 0 ? `${lines.length} drift finding(s)` : 'no drift: the cluster matches the default branch',
      lines,
    );
  }

  private async apply(
    ctx: Ctx,
    pr: GitPullRequestEntity,
    info: PullRequestInfo,
    plan: PlanEntity,
    req: RequestWithUser,
    confirm: boolean,
    login: string,
    userId: string,
    done: (outcome: 'done' | 'refused', text: string, reasons?: string[]) => Promise<void>,
  ): Promise<void> {
    const denied = await this.plans.mayChange(req, plan.changes);

    if (denied) return await done('refused', denied);

    // Mergeable: no conflicts, not a draft, every other check green (3.30).
    const mergeability = await ctx.bot.mergeability(ctx.api, info, GIT_STATUS_CONTEXT);

    if (!mergeability.mergeable)
      return await done('refused', 'the pull request is not mergeable', mergeability.reasons);

    const notes: string[] = [];

    // A PR review by a linked operator / admin counts as the approval if the connection says so (3.29): only reviews
    // of the current head, only on the instance accounts are linked on, never the pull request author's own (H2/H3).
    if (ctx.connection.approvalByMergeReview && (await this.sync.linkedInstance(ctx.connection))) {
      const { approvals, ignored } = await ctx.bot.approvals(ctx.api, info);

      if (ignored) notes.push(ignored);

      for (const approval of approvals) {
        if (info.authorId && approval.userId === info.authorId) continue;

        const reviewer = await this.dataSource.getRepository(GitAccountEntity).findOne({
          where: { provider: ctx.connection.provider as 'github' | 'gitlab', providerUserId: approval.userId },
        });

        if (!reviewer) continue;

        try {
          await this.plans.approve(plan.id, linkedUserRequest(reviewer.userId));
          await this.audit.recordStandalone({
            actor: { type: 'user', id: reviewer.userId },
            action: 'git.review-approval',
            target: `plan/${plan.id}`,
            project: ctx.connection.project,
            details: { pr: info.number, commit: info.headSha, login: approval.login },
          });
        } catch {
          // Reviewers without the operator / admin role (or the plan author) don't count; the blockers say why.
        }
      }
    }

    await this.dataSource
      .getRepository(GitPullRequestEntity)
      .update({ id: pr.id }, { applyPlanId: plan.id, resultPosted: false, appliedBy: userId });

    let status: PlanStatus;

    try {
      status = (await this.plans.apply(plan.id, req, { confirm, via: 'git-bot' })).status as PlanStatus;
    } catch (error) {
      await this.dataSource
        .getRepository(GitPullRequestEntity)
        .update({ id: pr.id }, { applyPlanId: null, resultPosted: true, appliedBy: null });

      return await done('refused', message(error), [...reasonsOf(error), ...notes]);
    }

    await done('done', `applying plan ${plan.id.slice(0, 8)}; the result follows here`, notes);

    if (TERMINAL.has(status)) await this.finishApply(ctx.connection.id, plan.id);
    else await this.refreshComment(ctx, pr, { result: `Applying, started by @${login}.` });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Apply results
  // ---------------------------------------------------------------------------------------------------------------

  private async planStatusChanged(planId: string, status: PlanStatus | 'approved'): Promise<void> {
    if (status === 'approved' || !TERMINAL.has(status)) return;

    const prs = await this.dataSource.getRepository(GitPullRequestEntity).find({
      where: [
        { applyPlanId: planId, resultPosted: false },
        { planId, state: 'open' },
      ],
    });

    for (const pr of prs) {
      if (pr.applyPlanId === planId && !pr.resultPosted)
        this.enqueue(pr.connectionId, `apply result ${planId}`, () => this.finishApply(pr.connectionId, planId));
      else if (status === 'discarded')
        // Discarded elsewhere (console): the PR's locks go with it.
        this.enqueue(pr.connectionId, `discarded ${planId}`, async () => {
          await this.dataSource.transaction(async (manager) => {
            await lockTable(manager);
            await releaseLocks(manager, planId);
          });

          const ctx = await this.context(pr.connectionId);

          if (ctx)
            await this.refreshComment(ctx, pr, {
              result: 'The plan was discarded in Loadweaver; its locks are released.',
            });
        });
    }
  }

  /** Results of applies whose event was missed (another replica tracked them, a restart). */
  async reconcile(): Promise<void> {
    const waiting = await this.dataSource
      .getRepository(GitPullRequestEntity)
      .find({ where: { resultPosted: false }, take: 50 });

    if (waiting.length === 0) return;

    const plans = await this.dataSource
      .getRepository(PlanEntity)
      .find({ where: { id: In(waiting.flatMap((p) => (p.applyPlanId ? [p.applyPlanId] : []))) } });

    for (const pr of waiting) {
      const plan = plans.find((p) => p.id === pr.applyPlanId);

      if (plan && TERMINAL.has(plan.status))
        this.enqueue(pr.connectionId, `apply result ${plan.id}`, () => this.finishApply(pr.connectionId, plan.id));
    }
  }

  /**
   * Posts an apply's result once (claimed atomically): the commit status follows, a successful apply merges the PR
   * (if the connection auto-merges), a failed one rolled back and the PR stays open.
   */
  private async finishApply(connectionId: string, planId: string): Promise<void> {
    const claimed = (
      await this.dataSource
        .getRepository(GitPullRequestEntity)
        .createQueryBuilder()
        .update()
        .set({ resultPosted: true })
        .where('connection_id = :connectionId AND apply_plan_id = :planId AND result_posted = false', {
          connectionId,
          planId,
        })
        .returning(['id'])
        .execute()
    ).raw as { id: string }[];

    if (claimed.length === 0) return;

    const pr = await this.dataSource
      .getRepository(GitPullRequestEntity)
      .findOneOrFail({ where: { id: claimed[0].id } });
    const plan = await this.dataSource.getRepository(PlanEntity).findOne({ where: { id: planId } });
    const ctx = await this.context(connectionId);

    if (!plan || !ctx) return;

    const commit = await this.dataSource.getRepository(GitCommitEntity).findOne({
      where: { connectionId, kind: 'pull-request', planId },
      order: { createdAt: 'DESC' },
    });
    let state: GitCommitState | null = null;

    if (commit) {
      state = await this.sync.followPlan(commit, plan);
      await this.sync.report(ctx.connection, commit);
    }

    let result: string;

    if (plan.status === 'applied') {
      result = `Applied plan ${plan.id.slice(0, 8)}.`;

      const applied = plan.source?.commit ?? null;

      if (plan.source?.limited) {
        // Only part of the pull request runs: merging it would put the rest on the default branch unapplied (L9).
        result += ` Only part of the pull request was applied (limited to \`${plan.source.limited}\`), so it was not merged; plan and apply the rest (\`loadweaver plan\`), then merge.`;
      } else if (ctx.connection.autoMerge) {
        try {
          const info = await ctx.bot.getPullRequest(ctx.api, pr.number);

          // Exactly the applied commit is merged: if the head moved, the provider refuses (M1).
          if (!applied || info.headSha !== applied)
            result +=
              ' The pull request changed after it was planned, so it was not merged: the new head needs a new plan (`loadweaver plan`).';
          else {
            await ctx.bot.merge(
              ctx.api,
              pr.number,
              applied,
              `Merge #${pr.number}: Loadweaver plan ${plan.id.slice(0, 8)} applied`,
            );
            result += ' The pull request was merged, so the default branch matches what runs.';
          }
        } catch (error) {
          result += ` Merging failed (${message(error)}): if the pull request changed after it was planned, it needs a new plan (\`loadweaver plan\`); otherwise merge it yourself, the default branch should match what runs.`;
        }
      } else {
        result += ' Merge the pull request so the default branch matches what runs.';
      }
    } else {
      result = `The apply of plan ${plan.id.slice(0, 8)} ${plan.status === 'rollback-failed' ? 'failed and its rollback failed too' : 'failed and was rolled back'}${plan.progress?.failure ? `: ${plan.progress.failure}` : plan.error ? `: ${plan.error}` : ''}. The pull request stays open; push a fix or comment \`loadweaver plan\`.`;
    }

    await this.audit.recordStandalone({
      actor: pr.appliedBy ? { type: 'user', id: pr.appliedBy } : SYSTEM,
      action: 'git.pr.applied',
      target: `git/connection/${connectionId}`,
      project: ctx.connection.project,
      details: { pr: pr.number, commit: pr.headSha, plan: plan.id, status: plan.status, commitState: state },
    });
    await this.reply(ctx, pr.number, renderReply(pr.author ?? '', 'apply', result));
    await this.refreshComment(ctx, pr, { result });
  }
}
