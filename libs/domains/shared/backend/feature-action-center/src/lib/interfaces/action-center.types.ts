/**
 * Action center contracts shared by every product.
 *
 * Products register {@link ActionCenterSource}s that derive open to-dos ("next steps") from their own data. The
 * engine collects all sources per scope (Decabill: tenant, Agenstra: instance), applies the caller's role and
 * silences, and serves the result over REST and Socket.IO. Texts are not part of the payload: frontends localize
 * each item `type` and its `params` (see the shared frontend presenters).
 */

/** Visual weight of a group: `danger` (something failed / is overdue), `warning` (needs attention), `info`. */
export type ActionCenterSeverity = 'info' | 'warning' | 'danger';

/**
 * `task`: day-to-day work derived from business data (unsent invoices, failed runs, ...).
 * `setup`: onboarding / configuration suggestions, highlighted at the top of the panel.
 */
export type ActionCenterKind = 'task' | 'setup';

/**
 * Who may see a group: `administrative` (admins and managers) or `admin` (admins only, e.g. items whose fix lives on
 * an admin-only settings page).
 */
export type ActionCenterAudience = 'administrative' | 'admin';

/** Console roles that may use the action center. */
export type ActionCenterViewerRole = 'admin' | 'manager';

/** Scalar values of item / group parameters (rendered by the frontend presenters). */
export type ActionCenterParamValue = string | number | boolean | null;

export type ActionCenterParams = Readonly<Record<string, ActionCenterParamValue>>;

/** One concrete to-do inside a group (e.g. one unsent invoice). */
export interface ActionCenterItem {
  /** Stable id within the group's type (usually the entity id); used for item silences. */
  id: string;
  /** Presenter parameters (number, name, amount, workspace id, ...). Never put secrets here. */
  params?: ActionCenterParams;
  /** When the item became relevant (ISO 8601); newest first in the panel. */
  occurredAt?: string | null;
}

/** What a source reports for one item type. */
export interface ActionCenterGroupDraft {
  /** Globally unique item type, `<application>.<area>.<condition>` (e.g. `decabill.invoices.unsent`). */
  type: string;
  /** Grouping heading in the panel (e.g. `receivables`, `accounting`, `setup`). */
  category: string;
  severity: ActionCenterSeverity;
  kind: ActionCenterKind;
  /** Defaults to `administrative`. */
  audience?: ActionCenterAudience;
  /** Number of matching records (may exceed `items.length`). */
  total: number;
  /** Up to `itemLimit` items, newest first. Setup groups usually carry none. */
  items: ActionCenterItem[];
  /** Group-level presenter parameters (e.g. the missing setting keys). */
  params?: ActionCenterParams;
}

/** Context passed to every source; the product's scope (tenant) is already active. */
export interface ActionCenterCollectContext {
  scopeKey: string;
  /** Maximum number of items a source should return per group. */
  itemLimit: number;
  now: Date;
}

/** A product-specific producer of action center groups. */
export interface ActionCenterSource {
  /** Unique key of the source (log / error reporting). */
  readonly key: string;
  /** Every item type this source can report (silences are validated against the union of all sources). */
  readonly types: readonly string[];
  /** Return only groups with `total > 0`; a thrown error drops this source from the snapshot (logged). */
  collect(context: ActionCenterCollectContext): Promise<ActionCenterGroupDraft[]>;
}

/** Normalized group as computed for a scope (before role and silence filtering). */
export interface ActionCenterGroup extends Required<Omit<ActionCenterGroupDraft, 'params'>> {
  params: ActionCenterParams;
}

/** Everything open in one scope, independent of the viewer. */
export interface ActionCenterSnapshot {
  scopeKey: string;
  generatedAt: string;
  /** Content hash; equal fingerprints mean equal groups. */
  fingerprint: string;
  groups: ActionCenterGroup[];
}

/** The authenticated console user looking at the action center. */
export interface ActionCenterViewer {
  userId: string;
  role: ActionCenterViewerRole;
  scopeKey: string;
  /**
   * Optional record-level restriction: items carrying `param` are visible only when its value is listed (e.g. the
   * workspaces a personal access token may access). Items without the param stay visible. `null` / omitted = all.
   */
  restriction?: ActionCenterViewerRestriction | null;
  /**
   * Optional group filter (REST only, e.g. a personal access token may only see groups whose domain scope it holds).
   * Silences of hidden groups are hidden too.
   */
  groupFilter?: ((type: string, category: string) => boolean) | null;
}

export interface ActionCenterViewerRestriction {
  param: string;
  values: readonly string[];
}

/** Who a silence applies to. */
export type ActionCenterSilenceAudience = 'self' | 'everyone';

export interface ActionCenterSilenceView {
  id: string;
  itemType: string;
  /** `null` silences the whole type. */
  itemId: string | null;
  audience: ActionCenterSilenceAudience;
  /** `null` = until removed. */
  until: string | null;
  createdAt: string;
  createdByUserId: string | null;
  /** Whether the viewer may remove the silence (own silences; `everyone` silences only for admins). */
  removable: boolean;
}

export interface ActionCenterViewItem extends ActionCenterItem {
  occurredAt: string | null;
  params: ActionCenterParams;
  /** Silence that hides this item for the viewer, if any. */
  silencedBy: string | null;
}

export interface ActionCenterViewGroup {
  type: string;
  category: string;
  severity: ActionCenterSeverity;
  kind: ActionCenterKind;
  audience: ActionCenterAudience;
  total: number;
  /** Open (not silenced) items of the group the viewer still has to handle. */
  openCount: number;
  params: ActionCenterParams;
  items: ActionCenterViewItem[];
  /** Silence that hides the whole group for the viewer, if any. */
  silencedBy: string | null;
}

export interface ActionCenterViewCounts {
  /** Open to-dos (tasks and setup suggestions) that are not silenced: the top-bar badge. */
  open: number;
  /** Open setup suggestions (subset of `open`). */
  setup: number;
  /** Items hidden by silences. */
  silenced: number;
}

/** What one viewer receives (REST `GET` and the `actionCenterSnapshot` socket event). */
export interface ActionCenterView {
  generatedAt: string;
  role: ActionCenterViewerRole;
  /** Whether the viewer may create / remove silences for everyone. */
  canSilenceForEveryone: boolean;
  counts: ActionCenterViewCounts;
  groups: ActionCenterViewGroup[];
  silences: ActionCenterSilenceView[];
}

/**
 * What SQL-based sources need from TypeORM: a `DataSource`, an `EntityManager` or any `Repository` (all expose
 * `query`). Keeps sources independent of how the product provides its connection.
 */
export interface ActionCenterSqlRunner {
  query(sql: string, parameters?: unknown[]): Promise<any>;
}

/** A silence was created / updated or removed (products publish it as a webhook event). */
export interface ActionCenterSilenceChange {
  change: 'created' | 'removed';
  /** Who changed it. */
  actor: ActionCenterViewer;
  silence: {
    id: string;
    itemType: string;
    itemId: string | null;
    audience: ActionCenterSilenceAudience;
    until: string | null;
  };
}
