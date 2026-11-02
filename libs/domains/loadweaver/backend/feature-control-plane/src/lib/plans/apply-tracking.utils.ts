import type { NodeApplyState, PlanProgress } from '../entities/plan.entity';

/** The cluster lock: taken by cluster-wide changes, conflicting with every other lock. */
export const CLUSTER_LOCK = 'cluster';

/** What a plan locks (3.8): exactly the resources its diff touches, the whole cluster for the cluster resource. */
export function lockScopes(
  changes: readonly { action: string; kind: string; name: string; project: string | null }[],
): string[] {
  const touched = changes.filter((c) => c.action !== 'unchanged');

  if (touched.some((c) => c.kind === 'Cluster')) return [CLUSTER_LOCK];

  return [...new Set(touched.map((c) => `${c.kind}/${c.project ?? ''}/${c.name}`))].sort();
}

/**
 * Locks of other plans standing in the way. A fix-forward plan may take over the locks of the failed plan it
 * resolves (only plans that resolve an inconsistent state may take them, 3.19).
 */
export function lockConflicts(
  requested: readonly string[],
  held: readonly { scope: string; planId: string }[],
  planId: string,
  takeOver: string | null = null,
): { scope: string; planId: string }[] {
  const others = held.filter((l) => l.planId !== planId && l.planId !== takeOver);

  if (requested.includes(CLUSTER_LOCK)) return others;

  return others.filter((l) => l.scope === CLUSTER_LOCK || requested.includes(l.scope));
}

export interface ReportingNode {
  name: string;
  appliedRevision: number;
  lastReportRevision: number | null;
  applyStatus: string | null;
  applyError: string | null;
  lastReportSteps: { layer: string; status: string }[] | null;
  connected: boolean;
  lastSeenAt: Date | null;
}

/** A node is expected to report when its agent stream is open and its heartbeat fresh. */
export function reporting(
  node: Pick<ReportingNode, 'connected' | 'lastSeenAt'>,
  now: number,
  timeoutMs: number,
): boolean {
  return node.connected && !!node.lastSeenAt && now - node.lastSeenAt.getTime() <= timeoutMs;
}

/**
 * Where each node stands on the way to its target revision: applied (reached it), failed (reported failure /
 * rollback for it), skipped (not connected: converges when it is back), or still pending.
 */
export function nodeStates(
  nodes: readonly ReportingNode[],
  targets: Readonly<Record<string, number>>,
  previous: PlanProgress['nodes'],
  now: number,
  heartbeatTimeoutMs: number,
): PlanProgress['nodes'] {
  const result: PlanProgress['nodes'] = {};

  for (const node of nodes) {
    const revision = targets[node.name];

    if (revision === undefined) continue;

    const before = previous[node.name];

    if (before && before.state !== 'pending') {
      result[node.name] = before;
      continue;
    }

    const steps =
      node.lastReportRevision !== null && node.lastReportRevision >= revision
        ? (node.lastReportSteps ?? undefined)
        : undefined;
    let state: NodeApplyState = 'pending';
    let error: string | undefined;

    if (node.appliedRevision >= revision) state = 'applied';
    else if (
      node.lastReportRevision !== null &&
      node.lastReportRevision >= revision &&
      node.applyStatus !== 'applied'
    ) {
      state = 'failed';
      error = node.applyError ?? `apply ${node.applyStatus ?? 'failed'}`;
    } else if (!reporting(node, now, heartbeatTimeoutMs)) state = 'skipped';

    result[node.name] = { state, ...(steps ? { steps } : {}), ...(error ? { error: error.slice(0, 500) } : {}) };
  }

  return result;
}

/** Step text and percentage (never above 99 until done, Agenstra's rule). */
export function summarize(
  phase: PlanProgress['phase'],
  nodes: PlanProgress['nodes'],
): { done: boolean; failure?: string; percent: number; step: string } {
  const entries = Object.entries(nodes);
  const settled = entries.filter(([, n]) => n.state !== 'pending');
  const failed = entries.find(([, n]) => n.state === 'failed');
  const pending = entries.filter(([, n]) => n.state === 'pending').map(([name]) => name);
  const verb = phase === 'apply' ? 'Applying' : 'Rolling back';

  if (pending.length === 0)
    return {
      done: true,
      ...(failed ? { failure: `${failed[0]}: ${failed[1].error ?? 'failed'}` } : {}),
      percent: 100,
      step: failed ? `${verb} failed on ${failed[0]}` : `${verb} done`,
    };

  const running = nodes[pending[0]]?.steps?.find((s) => s.status !== 'applied' && s.status !== 'unchanged')?.layer;

  return {
    done: false,
    percent: entries.length === 0 ? 99 : Math.min(99, Math.round((settled.length / entries.length) * 100)),
    step: `${verb}: waiting for ${pending.slice(0, 3).join(', ')}${pending.length > 3 ? ` and ${pending.length - 3} more` : ''}${running ? ` (${running})` : ''}`,
  };
}
