import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not } from 'typeorm';

import { GitCommitEntity, GitConnectionEntity, type GitCommitState } from '../entities/git.entity';
import type { PlanEntity } from '../entities/plan.entity';

/** "Default branch ahead of cluster" (3.29 / 3.30): the branch head's plan isn't applied (or it was rejected). */
export interface GitAheadEntry {
  connection: string;
  /** `cluster` or the project. */
  scope: string;
  commit: string;
  planId: string | null;
  state: GitCommitState;
  reason: string | null;
  since: string;
}

/** Commit states where the branch head and the cluster agree. */
const IN_SYNC: ReadonlySet<GitCommitState> = new Set(['applied', 'no-changes', 'synced']);

/** The connection that carries a resource of `project` (null = cluster-level), per the scope rule (3.29). */
export function carrierOf<T extends Pick<GitConnectionEntity, 'project'>>(
  project: string | null,
  connections: readonly T[],
): T | null {
  return (
    (project !== null ? connections.find((c) => c.project === project) : undefined) ??
    connections.find((c) => c.project === null) ??
    null
  );
}

/** Connections whose scope a set of changes touches. */
export function touchedConnections<T extends Pick<GitConnectionEntity, 'project' | 'id'>>(
  changes: readonly { action: string; project: string | null }[],
  connections: readonly T[],
): T[] {
  const touched = new Map<string, T>();

  for (const change of changes.filter((c) => c.action !== 'unchanged')) {
    const carrier = carrierOf(change.project, connections);

    if (carrier) touched.set(carrier.id, carrier);
  }

  return [...touched.values()];
}

/**
 * Read-side of Git connections for the plans (3.29): which scopes are authoritative, so UI / API plans there can't
 * be applied directly (they go through a pull request).
 */
@Injectable()
export class GitScopeService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async connections(manager: EntityManager = this.dataSource.manager): Promise<GitConnectionEntity[]> {
    return await manager.getRepository(GitConnectionEntity).find({ order: { scopeKey: 'ASC' } });
  }

  /** Connections whose branch head isn't what runs: its plan is pending / failed / discarded, or it was rejected. */
  async ahead(manager: EntityManager = this.dataSource.manager): Promise<GitAheadEntry[]> {
    const entries: GitAheadEntry[] = [];

    for (const connection of await this.connections(manager)) {
      if (!connection.lastSyncedCommit) continue;

      const head = await manager.getRepository(GitCommitEntity).findOne({
        // Pull request heads (plan bot) can share a sha with the branch after a fast-forward merge; they don't count.
        where: { connectionId: connection.id, sha: connection.lastSyncedCommit, kind: Not('pull-request') },
        order: { createdAt: 'DESC' },
      });

      if (!head || IN_SYNC.has(head.state)) continue;

      entries.push({
        connection: connection.id,
        scope: connection.project ?? 'cluster',
        commit: head.sha,
        planId: head.planId,
        state: head.state,
        reason: head.reason,
        since: head.createdAt.toISOString(),
      });
    }

    return entries;
  }

  /**
   * Why a plan can't be applied directly: it changes an authoritative scope and didn't come from Git, or it is a pull
   * request's plan (3.30: applied by `loadweaver apply` on the pull request, so mergeability is checked).
   */
  async blockers(
    manager: EntityManager,
    plan: Pick<PlanEntity, 'changes' | 'source'>,
    options: { via?: 'git-bot' } = {},
  ): Promise<string[]> {
    if (plan.source?.kind === 'git' && plan.source.pr !== undefined && options.via !== 'git-bot')
      return [
        `this plan belongs to pull request #${plan.source.pr}${plan.source.prUrl ? ` (${plan.source.prUrl})` : ''}: apply it with a \`loadweaver apply\` comment there`,
      ];

    if (plan.source?.kind === 'git' || plan.source?.kind === 'system') return [];

    const authoritative = touchedConnections(plan.changes, await this.connections(manager)).filter(
      (c) => c.mode === 'authoritative',
    );

    return authoritative.map((c) => {
      const pr = plan.source?.pullRequests?.find((p) => p.connection === c.id);
      const scope = c.project ? `project ${c.project}` : 'the cluster scope';
      const via = pr?.url ? `pull request ${pr.url}` : pr ? `branch ${pr.branch}` : 'a pull request';
      const how =
        c.provider === 'github' || c.provider === 'gitlab'
          ? 'the plan bot plans it there; comment `loadweaver apply` on it'
          : 'merging it creates the plan to apply';

      return `${scope} is managed in Git (authoritative): this change is applied through ${via}; ${how}`;
    });
  }
}
