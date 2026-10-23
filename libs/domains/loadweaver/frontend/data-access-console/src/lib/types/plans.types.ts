/** Plans (3.8 / 3.12 / 3.19): `GET /plans`, `GET /plans/{id}` and the `socket/plans` events. */

export type PlanStatus =
  | 'pending'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'discarded'
  | 'rolling-back'
  | 'rolled-back'
  | 'rollback-failed';

export type PlanChangeAction = 'create' | 'update' | 'delete' | 'unchanged';

/** One resource the plan creates, updates, deletes or leaves as it is, with its spec before and after. */
export interface PlanResourceChange {
  action: PlanChangeAction;
  kind: string;
  name: string;
  project: string | null;
  /** Generation the change was planned against (0 = did not exist). */
  baseGeneration: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/**
 * Compiled effect on one network layer (`tunnels`, `routing`, `filtering`, `egress`, `dns`, `dns-records`,
 * `remote-access`, …), e.g. "adds WireGuard peer n1↔n3". `policies` names the policies behind it.
 */
export interface PlanNetworkChange {
  layer: string;
  action: string;
  node: string;
  summary: string;
  policies?: string[];
  [key: string]: unknown;
}

/** Replica starts, stops and moves with the chosen method (3.10). */
export interface PlanWorkloadChange {
  /** `copy`: a volume copy added on `to` for an existing volume (M6 gate), with `volume` instead of `replica`. */
  action: 'start' | 'stop' | 'move' | 'copy';
  replica?: string;
  /** The volume (`project/deployment/volume`) of a `copy`. */
  volume?: string;
  /** `sync` (primary's site) or `remote` copy. */
  copy?: 'sync' | 'remote';
  from?: string;
  to?: string;
  /** Live (CRIU pre-copy), stop-and-copy (gVisor), QEMU live migration (VMs / generic microVMs), blue / green or short stop. */
  method?: 'live' | 'stop-and-copy' | 'vm-live' | 'blue-green' | 'short-stop';
  /** The method with its reason, e.g. `short-stop (privileged container)`, `microvm-live (QEMU)`. */
  methodLabel?: string;
  [key: string]: unknown;
}

/** A single point of failure: what a node / site loss would take down (3.12). */
export interface PlanFailureFinding {
  scope: { kind: 'node' | 'site'; name: string };
  kind: 'data' | 'deployment' | 'capacity';
  subject: string;
  reason: string;
}

export interface PlanFailureAnalysis {
  findings: PlanFailureFinding[];
  /** Every single node loss can be absorbed by the remaining nodes. */
  nPlusOne: boolean;
  [key: string]: unknown;
}

/** Warnings and diagnostics: compose warnings, unacknowledged pins (`pin: true`), DNS / RPKI / IPAM notes. */
export interface PlanIssue {
  level?: string;
  path?: string;
  message?: string;
  project?: string;
  deployment?: string;
  /** An unacknowledged pin: apply needs `confirm: true`. */
  pin?: boolean;
  [key: string]: unknown;
}

export type PlanNodeApplyState = 'pending' | 'applied' | 'failed' | 'skipped';

/** Live progress of an apply or rollback: step + %, per node and layer. */
export interface PlanProgress {
  phase: 'apply' | 'rollback';
  baseRevision: number;
  targets: Record<string, number> | null;
  step: string;
  percent: number;
  startedAt: string;
  nodes: Record<string, { state: PlanNodeApplyState; steps?: { layer: string; status: string }[]; error?: string }>;
  failure?: string;
  cause?: string;
}

/** A pull request Loadweaver opened for a plan of a Git-authoritative scope (3.29), or why it couldn't. */
export interface PlanPullRequest {
  /** The Git connection's id. */
  connection: string;
  branch: string;
  url?: string;
  number?: number;
  error?: string;
  /** The pull request is being opened in the background; its URL appears on the plan afterwards. */
  pending?: boolean;
}

export type PlanSourceKind = 'git' | 'ui' | 'api' | 'drift' | 'system';

/** Where a plan came from (3.29): a Git commit (connection, commit, ref, PR, author), the UI, the API, drift, system. */
export interface PlanSource {
  kind: PlanSourceKind;
  connection?: string;
  commit?: string;
  ref?: string;
  pr?: number;
  /** The pull / merge request's URL (plan bot). */
  prUrl?: string;
  author?: string;
  /** Loadweaver user ids of the change's Git authors: they can't approve the plan. */
  authors?: string[];
  /** A plan bot plan limited to one project / path (`loadweaver plan <x>`). */
  limited?: string;
  /** Authoritative scopes: the pull requests this plan was turned into; it is applied through them. */
  pullRequests?: PlanPullRequest[];
  /** The UI / API plan of an authoritative scope that this pull request plan replaces. */
  supersedes?: string;
  /** Set on a UI / API plan that a pull request plan replaced (it is discarded). */
  supersededBy?: string;
}

export interface PlanApproval {
  project: string;
  userId: string;
  createdAt: string;
}

/** `PlanResponseDto`. */
export interface Plan {
  id: string;
  status: PlanStatus;
  changes: PlanResourceChange[];
  networkChanges: PlanNetworkChange[];
  diagnostics: PlanIssue[];
  workloadChanges: PlanWorkloadChange[];
  failureAnalysis: PlanFailureAnalysis | null;
  /** Pinned images and secret versions per deployment (`project/name`) this plan applies (3.22). */
  deploymentStates: Record<string, { images: Record<string, string>; secretVersions: Record<string, number> }>;
  warnings: PlanIssue[];
  createdBy: string | null;
  /** The author's role per touched project when planned (3.17). */
  creatorRoles: Record<string, string>;
  /** Per project: why its part is risky. */
  risk: Record<string, string[]>;
  /** Always empty on the socket; read them with `GET /plans/{id}`. */
  approvals: PlanApproval[];
  progress: PlanProgress | null;
  /** The failed plan this fix-forward resolves. */
  resolves: string | null;
  /** Where the plan came from; null for plans from before GitOps. */
  source?: PlanSource | null;
  error: string | null;
  createdAt: string;
  appliedAt: string | null;
}

/** Socket `plansSnapshot` (on connect) payload. */
export interface PlansSnapshotEvent {
  plans: Plan[];
}

/** Socket `planPatch` payload. */
export interface PlanPatchEvent {
  plan: Plan;
}

/** `GET /plans` filters: newest first, at most `limit` (1–200, default 50) after filtering. */
export interface PlanListQuery {
  limit?: number;
  status?: PlanStatus;
  /** Only plans with a change in this project. */
  project?: string;
}

/** A resource reference for deletions and refreshes in `POST /plans`. */
export interface PlanResourceRef {
  kind: string;
  name: string;
  project?: string;
}

/** `POST /plans`: a multi-document YAML bundle to create or update, and / or resources to delete. */
export interface CreatePlanRequest {
  documents?: string;
  delete?: PlanResourceRef[];
  refresh?: PlanResourceRef[];
}
