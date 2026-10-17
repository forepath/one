import {
  authoritativeConnectionsOf,
  sourceBypassesGit,
  type AccessMe,
  type GitConnection,
  type Plan,
  type PlanChangeAction,
  type PlanIssue,
  type PlanNetworkChange,
  type PlanNodeApplyState,
  type PlanPullRequest,
  type PlanStatus,
} from '@forepath/loadweaver/frontend/data-access-console';

type Tone = 'success' | 'warning' | 'danger' | 'secondary' | 'info' | 'primary';

export const PLAN_STATUSES: PlanStatus[] = [
  'pending',
  'applying',
  'applied',
  'rolling-back',
  'rolled-back',
  'rollback-failed',
  'failed',
  'discarded',
];

export const PLAN_STATUS_TONE: Record<PlanStatus, Tone> = {
  pending: 'info',
  applying: 'primary',
  applied: 'success',
  failed: 'secondary',
  discarded: 'secondary',
  'rolling-back': 'warning',
  'rolled-back': 'warning',
  'rollback-failed': 'danger',
};

export const PLAN_STATUS_ICON: Record<PlanStatus, string> = {
  pending: 'bi-hourglass-split',
  applying: 'bi-arrow-repeat',
  applied: 'bi-check-lg',
  failed: 'bi-x-circle',
  discarded: 'bi-trash',
  'rolling-back': 'bi-arrow-counterclockwise',
  'rolled-back': 'bi-arrow-counterclockwise',
  'rollback-failed': 'bi-exclamation-octagon',
};

export function planStatusLabel(status: PlanStatus): string {
  switch (status) {
    case 'pending':
      return $localize`:@@lwConsolePlans-statusPending:Pending`;
    case 'applying':
      return $localize`:@@lwConsolePlans-statusApplying:Applying`;
    case 'applied':
      return $localize`:@@lwConsolePlans-statusApplied:Applied`;
    case 'failed':
      return $localize`:@@lwConsolePlans-statusFailed:Failed (resolved)`;
    case 'discarded':
      return $localize`:@@lwConsolePlans-statusDiscarded:Discarded`;
    case 'rolling-back':
      return $localize`:@@lwConsolePlans-statusRollingBack:Rolling back`;
    case 'rolled-back':
      return $localize`:@@lwConsolePlans-statusRolledBack:Rolled back`;
    default:
      return $localize`:@@lwConsolePlans-statusRollbackFailed:Rollback failed`;
  }
}

export const CHANGE_ACTION_TONE: Record<PlanChangeAction, Tone> = {
  create: 'success',
  update: 'info',
  delete: 'danger',
  unchanged: 'secondary',
};

export function changeActionLabel(action: PlanChangeAction): string {
  switch (action) {
    case 'create':
      return $localize`:@@lwConsolePlans-actionCreate:Create`;
    case 'update':
      return $localize`:@@lwConsolePlans-actionUpdate:Update`;
    case 'delete':
      return $localize`:@@lwConsolePlans-actionDelete:Delete`;
    default:
      return $localize`:@@lwConsolePlans-actionUnchanged:Unchanged`;
  }
}

export const NODE_STATE_TONE: Record<PlanNodeApplyState, Tone> = {
  pending: 'info',
  applied: 'success',
  failed: 'danger',
  skipped: 'secondary',
};

export function nodeStateLabel(state: PlanNodeApplyState): string {
  switch (state) {
    case 'pending':
      return $localize`:@@lwConsolePlans-nodePending:Pending`;
    case 'applied':
      return $localize`:@@lwConsolePlans-nodeApplied:Applied`;
    case 'failed':
      return $localize`:@@lwConsolePlans-nodeFailed:Failed`;
    default:
      return $localize`:@@lwConsolePlans-nodeSkipped:Skipped (offline)`;
  }
}

/** Network layers of the compiled effect, in the order they're shown. */
const LAYER_ORDER = [
  'tunnels',
  'routing',
  'filtering',
  'egress',
  'remote-access',
  'dns',
  'dns-records',
  'dnssec',
  'ipam',
];

export function layerLabel(layer: string): string {
  switch (layer) {
    case 'tunnels':
      return $localize`:@@lwConsolePlans-layerTunnels:Tunnels (WireGuard)`;
    case 'routing':
      return $localize`:@@lwConsolePlans-layerRouting:Routing`;
    case 'filtering':
      return $localize`:@@lwConsolePlans-layerFiltering:Filtering (policies)`;
    case 'egress':
      return $localize`:@@lwConsolePlans-layerEgress:Egress`;
    case 'remote-access':
      return $localize`:@@lwConsolePlans-layerRemoteAccess:Remote access`;
    case 'dns':
      return $localize`:@@lwConsolePlans-layerDns:Service discovery (DNS)`;
    case 'dns-records':
      return $localize`:@@lwConsolePlans-layerDnsRecords:Public DNS records`;
    case 'dnssec':
      return $localize`:@@lwConsolePlans-layerDnssec:DNSSEC`;
    default:
      return layer;
  }
}

/** The compiled network effect grouped by layer (DNS and policy diffs included). */
export function groupByLayer(changes: readonly PlanNetworkChange[]): { layer: string; changes: PlanNetworkChange[] }[] {
  const groups = new Map<string, PlanNetworkChange[]>();

  for (const change of changes) {
    const layer = String(change.layer ?? 'other');

    groups.set(layer, [...(groups.get(layer) ?? []), change]);
  }

  const rank = (layer: string) => (LAYER_ORDER.includes(layer) ? LAYER_ORDER.indexOf(layer) : LAYER_ORDER.length);

  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([layer, list]) => ({ layer, changes: list }));
}

/** Projects the plan touches. */
export function planProjects(plan: Plan): string[] {
  return [...new Set(plan.changes.flatMap((c) => (c.project ? [c.project] : [])))].sort();
}

/** Changed resources, without the unchanged ones. */
export function planTouched(plan: Plan) {
  return plan.changes.filter((c) => c.action !== 'unchanged');
}

/** Short summary for lists: the first changed resources. */
export function planSummary(plan: Plan, max = 3): string {
  const touched = planTouched(plan);

  if (touched.length === 0) return $localize`:@@lwConsolePlans-noChanges:No changes`;

  const names = touched.slice(0, max).map((c) => `${c.kind} ${c.project ? `${c.project}/` : ''}${c.name}`);

  return touched.length > max
    ? $localize`:@@lwConsolePlans-summaryMore:${names.join(', ')}:names: and ${touched.length - max}:count: more`
    : names.join(', ');
}

/** Warnings an apply has to confirm (`pin: true`). */
export function pinWarnings(plan: Plan): PlanIssue[] {
  return plan.warnings.filter((w) => w.pin === true);
}

/** The readable sentence of a warning / diagnostic, whatever shape it has. */
export function issueText(issue: PlanIssue): string {
  const where = [issue.project, issue.deployment].filter(Boolean).join('/');
  const prefix = [where, issue.path].filter(Boolean).join(' · ');
  const message =
    typeof issue.message === 'string'
      ? issue.message
      : typeof issue['summary'] === 'string'
        ? (issue['summary'] as string)
        : JSON.stringify(issue);

  return prefix ? `${prefix}: ${message}` : message;
}

export function issueTone(issue: PlanIssue): 'danger' | 'warning' | 'info' {
  return issue.level === 'error' ? 'danger' : issue.level === 'info' ? 'info' : 'warning';
}

const MANAGERS = ['operator', 'admin'];
const CHANGERS = ['developer', 'operator', 'admin'];

/** Operators / admins of a touched project who didn't create the plan and haven't approved it yet (3.17). */
export function mayApprove(plan: Plan, me: AccessMe | null): boolean {
  if (plan.status !== 'pending' || !me?.userId || me.userId === plan.createdBy) return false;

  // The change's Git authors can't approve it either.
  if (plan.source?.authors?.includes(me.userId)) return false;

  return planProjects(plan).some(
    (project) =>
      MANAGERS.includes(me.projects[project] ?? '') &&
      !plan.approvals.some((a) => a.project === project && a.userId === me.userId),
  );
}

/**
 * Who may apply / cancel / discard (the server checks the details): infra roles for cluster-level changes, at least
 * developer in every touched project.
 */
export function mayChange(plan: Plan, me: AccessMe | null): boolean {
  if (!me) return false;

  if (me.clusterRole === 'cluster-admin') return true;

  const touched = planTouched(plan);
  const clusterLevel = touched.some((c) => !c.project);

  if (clusterLevel && me.clusterRole !== 'infra-operator') return false;

  return planProjects(plan).every((p) => CHANGERS.includes(me.projects[p] ?? ''));
}

/** `git-conflict` warnings: resources changed outside Git since the last sync, which the plan would overwrite. */
export function gitConflicts(plan: Plan): PlanIssue[] {
  return plan.warnings.filter((w) => w.path === 'git-conflict');
}

/** An authoritative Git scope a UI / API / drift plan touches: it is applied only through Git. */
export interface GitApplyBlocker {
  connectionId: string;
  /** null when the caller can't read the connection. */
  connection: GitConnection | null;
  /** The pull request (or branch) opened for this plan in that scope, if any. */
  pullRequest: PlanPullRequest | null;
}

/** Pull requests still being opened in the background (their URL appears on the plan later). */
export function hasPendingPullRequests(plan: Plan | null | undefined): boolean {
  return (plan?.source?.pullRequests ?? []).some((p) => p.pending === true && !p.url && !p.error);
}

/** Only http(s) links from a plan's source are rendered (never another scheme). */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);

    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * Why a plan can't be applied directly (3.29): it changes an authoritative scope and didn't come from Git or the
 * system. Uses the opened pull requests (always there for such plans) and the readable connections.
 */
export function gitApplyBlockers(plan: Plan, connections: readonly GitConnection[]): GitApplyBlocker[] {
  if (sourceBypassesGit(plan.source)) return [];

  const blockers = new Map<string, GitApplyBlocker>();
  const pullRequests = plan.source?.pullRequests ?? [];

  for (const connection of authoritativeConnectionsOf(plan.changes, connections))
    blockers.set(connection.id, {
      connectionId: connection.id,
      connection,
      pullRequest: pullRequests.find((p) => p.connection === connection.id) ?? null,
    });

  // Pull requests of scopes the caller can't read still block; a readable scope that is no longer authoritative not.
  for (const pullRequest of pullRequests) {
    const connection = connections.find((c) => c.id === pullRequest.connection) ?? null;

    if (!blockers.has(pullRequest.connection) && !connection)
      blockers.set(pullRequest.connection, { connectionId: pullRequest.connection, connection, pullRequest });
  }

  return [...blockers.values()];
}
