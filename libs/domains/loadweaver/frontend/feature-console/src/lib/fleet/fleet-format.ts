import {
  isFleetClusterId,
  type FleetAvailability,
  type FleetCardCapacity,
  type FleetClusterHealth,
  type FleetHealthState,
  type FleetIdentityStatus,
  type FleetTrustOutcome,
  type FleetOperation,
  type FleetOperationKind,
  type FleetOperationStatus,
  type FleetRole,
  type FleetStepStatus,
} from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcBadgeTone } from '@forepath/shared/frontend/ui-components';

type Tone = 'success' | 'warning' | 'danger' | 'secondary' | 'info' | 'primary';

export const FLEET_CONNECTION_TONE: Record<FleetHealthState, Tone> = {
  healthy: 'success',
  degraded: 'warning',
  unreachable: 'danger',
  'credential-rejected': 'danger',
  unknown: 'secondary',
};

export const FLEET_CONNECTION_ICON: Record<FleetHealthState, string> = {
  healthy: 'bi-check-circle',
  degraded: 'bi-exclamation-triangle',
  unreachable: 'bi-x-octagon',
  'credential-rejected': 'bi-key',
  unknown: 'bi-question-circle',
};

/** Clusters a comparison needs at least (3.24); below that the fleet offers no "Compare" at all (2026-10-28). */
export const FLEET_COMPARE_MIN_CLUSTERS = 2;

/**
 * Whether the fleet's "Compare" (rail / sidebar entry, every Compare action, the `/fleet/compare` route) is offered: the
 * fleet has at least 2 clusters the caller can see (the fleet facade's cluster list). Frontend only.
 */
export function fleetCompareAvailable(clusters: readonly unknown[] | null | undefined): boolean {
  return (clusters?.length ?? 0) >= FLEET_COMPARE_MIN_CLUSTERS;
}

/**
 * Trust between the fleet and a cluster (3.24; 2026-10-29): whether the cluster verifies this fleet's identity claims
 * — approvals, favourites and saved views work through the fleet then. The fleet establishes it by itself where its
 * credential may; otherwise a fleet admin uses "Establish trust".
 */
export function fleetIdentityLabel(status: FleetIdentityStatus | undefined): string {
  switch (status) {
    case 'verified':
      return $localize`:@@lwConsoleFleet-identityVerified:Trusted`;
    case 'untrusted':
      return $localize`:@@lwConsoleFleet-identityUntrusted:Not trusted`;
    case 'unsupported':
      return $localize`:@@lwConsoleFleet-identityUnsupported:Not supported by the cluster's version`;
    default:
      return $localize`:@@lwConsoleFleet-identityUnknown:Not checked yet`;
  }
}

/** What trust means for the user, under the state (2026-10-29). */
export function fleetIdentityEffect(status: FleetIdentityStatus | undefined): string {
  return status === 'verified'
    ? $localize`:@@lwConsoleFleet-identityEffectVerified:Approvals, favourites and saved views work through the fleet as you.`
    : $localize`:@@lwConsoleFleet-identityEffectMissing:Until then, approvals, favourites and saved views don't work through the fleet for this cluster.`;
}

/** The last attempt to establish trust, in words (2026-10-29). */
export function fleetTrustOutcomeLabel(state: FleetTrustOutcome | undefined | null): string | null {
  switch (state) {
    case 'established':
      return $localize`:@@lwConsoleFleet-trustEstablished:Trust established`;
    case 'already-trusted':
      return $localize`:@@lwConsoleFleet-trustAlready:The cluster already trusted this fleet`;
    case 'forbidden':
      return $localize`:@@lwConsoleFleet-trustForbidden:The cluster refused: the credential may not register trusted fleets`;
    case 'identity-mismatch':
      return $localize`:@@lwConsoleFleet-trustMismatch:Not established: another cluster answered at this endpoint`;
    case 'unsupported':
      return $localize`:@@lwConsoleFleet-trustUnsupported:Not established: the cluster's version doesn't support it`;
    case 'failed':
      return $localize`:@@lwConsoleFleet-trustFailed:Not established: the cluster couldn't be reached`;
    case 'revoked':
      return $localize`:@@lwConsoleFleet-trustRevoked:Removed by a cluster admin`;
    default:
      return null;
  }
}

/**
 * The cluster's answer when the connection's credential can't carry fleet identities: a PAT without
 * `fleet:on-behalf-of` (older clusters: any non-PAT), or the API key while the cluster switched API key delegation off
 * (`LOADWEAVER_API_KEY_FLEET_DELEGATION=off`, 2026-10-29). Since 2026-10-29 the cluster's API key carries identities.
 */
const CLAIMS_IGNORED =
  /^(?:only PATs with \S+(?: or the cluster API key)? send fleet identities|API key fleet delegation is off on this cluster(?: \(\S+\))?)$/i;

/**
 * Trust as the cluster page shows it (2026-10-29): one state, derived from the fleet's health record only.
 * `trusted` (the cluster verified the fleet's claim), `pending` (an attempt succeeded after the cluster's last
 * answer: not confirmed yet), `not-in-effect` (the cluster ignores the fleet's identities on this connection: its
 * credential is a PAT without `fleet:on-behalf-of`, or the API key with API key delegation switched off, so
 * registering again changes nothing), `not-trusted`,
 * `unsupported`, `unknown`; `establishing` while a fleet admin's request runs.
 */
export type FleetTrustState =
  | 'establishing'
  | 'trusted'
  | 'pending'
  | 'not-in-effect'
  | 'not-trusted'
  | 'unsupported'
  | 'unknown';

export interface FleetTrustAttemptView {
  outcome: FleetTrustOutcome;
  label: string;
  tone: FpcBadgeTone;
  at: string;
  /** The fleet admin who asked; null = the fleet by itself ("automatically"). */
  by: string | null;
  /** The attempt succeeded, but the cluster's newer answer says it isn't trusted: shown as a past attempt. */
  superseded: boolean;
}

export interface FleetTrustView {
  state: FleetTrustState;
  label: string;
  tone: 'success' | 'warning' | 'neutral';
  icon: string;
  /** Trusted only: since when (the cluster's record). */
  since: string | null;
  /** The raw backend reason for the state (the page localises it); null when the state needs none. */
  reason: string | null;
  /** What the state means for the user. */
  effect: string | null;
  /** Whether "Establish trust…" can change the state (the page adds the caller's role and the connection). */
  establishable: boolean;
  attempt: FleetTrustAttemptView | null;
}

const SUCCESSFUL: readonly FleetTrustOutcome[] = ['established', 'already-trusted'];

function attemptTone(outcome: FleetTrustOutcome, superseded: boolean): FpcBadgeTone {
  if (superseded) return 'neutral';

  if (SUCCESSFUL.includes(outcome)) return 'success';

  return outcome === 'failed' || outcome === 'unsupported' ? 'neutral' : 'warning';
}

/**
 * The single source of truth of the cluster page's trust facts (2026-10-29): the identity probe decides the state;
 * the last attempt is a past event under it. An attempt newer than the probe's answer is `pending`, never "Not
 * trusted" next to "Trust established".
 */
export function fleetTrustView(health: FleetClusterHealth | null | undefined, busy = false): FleetTrustView {
  const identity = health?.identity ?? 'unknown';
  const last = health?.trust ?? null;
  const succeeded = !!last && SUCCESSFUL.includes(last.state);
  const answeredAt = health?.identityCheckedAt ?? health?.checkedAt ?? null;
  const unconfirmed =
    succeeded &&
    identity !== 'verified' &&
    (!answeredAt || new Date(last.at).getTime() > new Date(answeredAt).getTime());
  const claimsIgnored = identity === 'untrusted' && CLAIMS_IGNORED.test(health?.identityReason ?? '');

  const state: FleetTrustState = busy
    ? 'establishing'
    : identity === 'verified'
      ? 'trusted'
      : identity === 'unsupported'
        ? 'unsupported'
        : unconfirmed
          ? 'pending'
          : claimsIgnored
            ? 'not-in-effect'
            : identity === 'untrusted'
              ? 'not-trusted'
              : 'unknown';

  // A failed / refused attempt explains "Not trusted" best; otherwise the cluster's own answer.
  const reason =
    state === 'not-trusted'
      ? ((!succeeded ? last?.reason : null) ?? health?.identityReason ?? null)
      : state === 'not-in-effect' || state === 'unsupported'
        ? (health?.identityReason ?? null)
        : null;
  const superseded = succeeded && (state === 'not-trusted' || state === 'unknown');

  return {
    state,
    label: fleetTrustStateLabel(state),
    tone:
      state === 'trusted' ? 'success' : state === 'not-trusted' || state === 'not-in-effect' ? 'warning' : 'neutral',
    icon:
      state === 'establishing' || state === 'pending'
        ? 'bi-hourglass-split'
        : state === 'trusted'
          ? 'bi-shield-check'
          : state === 'not-trusted' || state === 'not-in-effect'
            ? 'bi-shield-exclamation'
            : 'bi-shield',
    since: state === 'trusted' ? (health?.identitySince ?? null) : null,
    reason,
    effect:
      state === 'trusted'
        ? fleetIdentityEffect('verified')
        : state === 'not-trusted' || state === 'not-in-effect'
          ? fleetIdentityEffect('untrusted')
          : null,
    establishable: state === 'not-trusted' || state === 'unknown',
    attempt: last
      ? {
          outcome: last.state,
          label: fleetTrustOutcomeLabel(last.state) ?? last.state,
          tone: attemptTone(last.state, superseded),
          at: last.at,
          by: last.by ?? null,
          superseded,
        }
      : null,
  };
}

export function fleetTrustStateLabel(state: FleetTrustState): string {
  switch (state) {
    case 'establishing':
      return $localize`:@@lwConsoleFleetCluster-trustEstablishing:Establishing…`;
    case 'trusted':
      return fleetIdentityLabel('verified');
    case 'pending':
      return $localize`:@@lwConsoleFleet-identityPending:Established, not confirmed by the cluster yet`;
    case 'not-in-effect':
      return $localize`:@@lwConsoleFleet-identityNotInEffect:Not in effect on this connection`;
    case 'not-trusted':
      return fleetIdentityLabel('untrusted');
    case 'unsupported':
      return fleetIdentityLabel('unsupported');
    default:
      return fleetIdentityLabel('unknown');
  }
}

export function fleetKeyStateLabel(state: string): string {
  switch (state) {
    case 'active':
      return $localize`:@@lwConsoleFleet-keyActive:active`;
    case 'next':
      return $localize`:@@lwConsoleFleet-keyNext:next (register, then activate)`;
    default:
      return $localize`:@@lwConsoleFleet-keyRetired:retired`;
  }
}

/** Tone badge of the approvals-through-the-fleet state (3.38 R10). */
export function fleetIdentityTone(status: FleetIdentityStatus | undefined): FpcBadgeTone {
  return status === 'verified' ? 'success' : status === 'untrusted' ? 'warning' : 'neutral';
}

/**
 * The fleet's connection to a cluster (LW-19): its own words, so they never read like the cluster's health headline
 * (Healthy / Degraded / At risk / Failed, `healthLabel`). `degraded` = reachable, but the probe found a problem (nodes
 * not connected, a server error).
 */
export function fleetConnectionLabel(state: FleetHealthState | string): string {
  switch (state) {
    case 'healthy':
      return $localize`:@@lwConsoleFleet-connConnected:Connected`;
    case 'degraded':
      return $localize`:@@lwConsoleFleet-connIssues:Connected with issues`;
    case 'unreachable':
      return $localize`:@@lwConsoleFleet-connUnreachable:Unreachable`;
    case 'credential-rejected':
      return $localize`:@@lwConsoleFleet-connCredentialRejected:Credential rejected`;
    default:
      return $localize`:@@lwConsoleFleet-connUnknown:Not checked yet`;
  }
}

export function fleetConnectionTone(state: string): Tone {
  return FLEET_CONNECTION_TONE[state as FleetHealthState] ?? 'secondary';
}

export function fleetConnectionIcon(state: string): string {
  return FLEET_CONNECTION_ICON[state as FleetHealthState] ?? 'bi-question-circle';
}

/**
 * The connection column of a cluster (3.43, 2026-10-31): a read-only cluster answers, but changes are paused, so it
 * shows as "Read-only" (warning) instead of "Connected"; everything else by the connection state.
 */
export function fleetConnectionState(
  health: Pick<FleetClusterHealth, 'state'>,
  availability: FleetAvailability | null | undefined,
): { label: string; tone: FpcBadgeTone; icon: string } {
  if (availability?.state === 'read-only')
    return { label: $localize`:@@lwConsoleFleet-connReadOnly:Read-only`, tone: 'warning', icon: 'lock' };

  const tone = fleetConnectionTone(health.state);

  return {
    label: fleetConnectionLabel(health.state),
    tone: tone === 'secondary' ? 'neutral' : tone,
    icon: fleetConnectionIcon(health.state).replace(/^bi-/, ''),
  };
}

export function fleetRoleLabel(role: FleetRole | string | null): string {
  switch (role) {
    case 'admin':
      return $localize`:@@lwConsoleFleet-roleAdmin:Admin`;
    case 'operator':
      return $localize`:@@lwConsoleFleet-roleOperator:Operator`;
    case 'viewer':
      return $localize`:@@lwConsoleFleet-roleViewer:Viewer`;
    default:
      return $localize`:@@lwConsoleFleet-roleNone:No access`;
  }
}

/** Tone badge of an operation's status (3.38 R10). */
export const FLEET_OPERATION_TONE: Record<FleetOperationStatus, FpcBadgeTone> = {
  running: 'primary',
  waiting: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export function fleetOperationStatusLabel(status: FleetOperationStatus | FleetStepStatus): string {
  switch (status) {
    case 'running':
      return $localize`:@@lwConsoleFleet-opRunning:Running`;
    case 'waiting':
      return $localize`:@@lwConsoleFleet-opWaiting:Waiting`;
    case 'succeeded':
      return $localize`:@@lwConsoleFleet-opSucceeded:Succeeded`;
    case 'failed':
      return $localize`:@@lwConsoleFleet-opFailed:Failed`;
    case 'cancelled':
      return $localize`:@@lwConsoleFleet-opCancelled:Cancelled`;
    case 'skipped':
      return $localize`:@@lwConsoleFleet-opSkipped:Skipped`;
    default:
      return $localize`:@@lwConsoleFleet-opPending:Pending`;
  }
}

export function fleetStepTone(status: FleetStepStatus): FpcBadgeTone {
  return status === 'pending' || status === 'skipped' ? 'neutral' : FLEET_OPERATION_TONE[status];
}

export function fleetOperationKindLabel(kind: FleetOperationKind): string {
  switch (kind) {
    case 'clone':
      return $localize`:@@lwConsoleFleet-kindClone:Clone`;
    case 'final-backup':
      return $localize`:@@lwConsoleFleet-kindFinalBackup:Final backup`;
    default:
      return $localize`:@@lwConsoleFleet-kindRestore:Cross-cluster restore`;
  }
}

/** Steps done (succeeded / skipped) in percent. */
export function fleetOperationProgress(operation: Pick<FleetOperation, 'steps' | 'status'>): number {
  if (operation.status === 'succeeded') return 100;

  if (operation.steps.length === 0) return 0;

  const done = operation.steps.filter((s) => s.status === 'succeeded' || s.status === 'skipped').length;

  return Math.round((done / operation.steps.length) * 100);
}

/** The step the operation is at (first not finished), for the list. */
export function fleetCurrentStep(operation: Pick<FleetOperation, 'steps'>): string | null {
  return (
    operation.steps.find((s) => s.status === 'running' || s.status === 'waiting' || s.status === 'failed')?.key ??
    operation.steps.find((s) => s.status === 'pending')?.key ??
    null
  );
}

export function fleetOperationActive(operation: Pick<FleetOperation, 'status'>): boolean {
  return operation.status === 'running' || operation.status === 'waiting';
}

/** Capacity share in percent (`40` for CPU, `62` for memory); `null` without capacity data. */
export function fleetCapacityPercent(capacity: FleetCardCapacity | null, kind: 'cpu' | 'memory'): number | null {
  const share = capacity?.[kind];

  if (!share || !share.total) return null;

  return share.percent ?? Math.round((share.used / share.total) * 100);
}

/**
 * The cluster and the path inside it for a fleet link (`/clusters/<id>/<path>`: cards and the merged inbox);
 * `null` for anything else.
 */
export function fleetLinkTarget(link: string): { clusterId: string; path: string } | null {
  const match = /^\/clusters\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?$/.exec(link);

  if (!match || !isFleetClusterId(match[1])) return null;

  const path = match[2] && match[2] !== '/' ? match[2] : '/';

  return { clusterId: match[1], path: `${path}${match[3] ?? ''}` };
}

/**
 * Console routes the fleet's relay never carries (the service user's personal resources — VPN devices — and the
 * cluster's trusted fleets): their pages show "not available through the fleet" in fleet mode, and the sidebar hides
 * them. Approvals work through the fleet only when the cluster verifies its identity claims (3.24); otherwise those
 * actions are hidden. Linked Git accounts are the signed person's since 2026-10-29 (3.41, `own` relay rules).
 */
export const FLEET_UNAVAILABLE_PATHS: readonly string[] = [
  // Git connections, webhooks and release announcements are relayed since 2026-10-27 (full parity).
  '/access/devices',
  // The cluster's list of trusted fleets: trust with this fleet is established and shown on the fleet's cluster page
  // (2026-10-29); listing / removing other fleets stays with the cluster's admins.
  '/settings/trusted-fleets',
];

/**
 * Items that need more than the console role suggests through the fleet: the relay carries the file browser, live
 * sessions' files and backup downloads only for the **admin** grant (cluster admin in console terms).
 */
export const FLEET_ADMIN_ONLY_PATHS: readonly string[] = ['/operate/files'];

/** Routes of the fleet itself and the account (available without an active cluster). */
export const FLEET_LEVEL_PATHS: readonly string[] = ['/fleet', '/account', '/settings', '/users', '/clusters'];

function pathOf(url: string): string {
  return url.split(/[?#]/)[0].replace(/^\/(de|en)(?=\/|$)/, '') || '/';
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Why a page of {@link FLEET_UNAVAILABLE_PATHS} stays in the cluster's own console — worded for that page (the
 * `/fleet/unavailable` notice); `null` for any other path.
 */
export function fleetUnavailableReason(url: string): string | null {
  const path = pathOf(url);

  if (under(path, '/access/devices'))
    return $localize`:@@lwConsoleFleetUnavailable-devices:VPN devices belong to the signed-in account. Through the fleet that is the fleet's service account, so your devices are managed in the cluster's own console.`;

  if (under(path, '/settings/trusted-fleets'))
    return $localize`:@@lwConsoleFleetUnavailable-trustedFleets:Trust between this fleet and the cluster is established and shown on the fleet's cluster page (Fleet › Clusters › the cluster). The cluster's full list of trusted fleets, and removing one, stays with the cluster's own admins.`;

  return null;
}

export function isFleetUnavailablePath(url: string): boolean {
  const path = pathOf(url);

  return FLEET_UNAVAILABLE_PATHS.some((prefix) => under(path, prefix));
}

/**
 * The fleet's own pages (`/fleet/…`), i.e. the fleet level (no open cluster); `/fleet/unavailable` is the notice for
 * a cluster view and belongs to the open cluster.
 */
export function isFleetPagePath(url: string): boolean {
  const path = pathOf(url);

  return under(path, '/fleet') && !under(path, '/fleet/unavailable');
}

export function isFleetLevelPath(url: string): boolean {
  const path = pathOf(url);

  return FLEET_LEVEL_PATHS.some((prefix) => under(path, prefix));
}

/**
 * Bounds of the fleet world map (plate carrée, one viewBox unit per degree): all longitudes, latitudes from 84° N (north
 * of Greenland) to 60° S (south of Cape Horn) — Antarctica and the polar seas are cut off, so the map is 360 × 144.
 */
export const WORLD_MAP_BOUNDS = { north: 84, south: -60, west: -180, east: 180 } as const;
export const WORLD_MAP_WIDTH = WORLD_MAP_BOUNDS.east - WORLD_MAP_BOUNDS.west;
export const WORLD_MAP_HEIGHT = WORLD_MAP_BOUNDS.north - WORLD_MAP_BOUNDS.south;

/**
 * Equirectangular projection of a coordinate onto the world map's viewBox (`0 0 360 144`): longitude → x (west edge
 * 0), latitude → y (north edge 0, south grows down). Coordinates beyond the bounds are clamped onto the edge.
 */
export function projectSite(latitude: number, longitude: number): { x: number; y: number } {
  const { north, south, west, east } = WORLD_MAP_BOUNDS;
  const lon = Math.max(west, Math.min(east, longitude));
  const lat = Math.max(south, Math.min(north, latitude));

  return { x: Math.round((lon - west) * 10) / 10, y: Math.round((north - lat) * 10) / 10 };
}

/** A coordinate for people, e.g. `50.11° N, 8.68° E`. */
export function formatCoordinates(latitude: number, longitude: number): string {
  const north = $localize`:@@lwConsoleFleetMap-north:N`;
  const south = $localize`:@@lwConsoleFleetMap-south:S`;
  const east = $localize`:@@lwConsoleFleetMap-east:E`;
  const west = $localize`:@@lwConsoleFleetMap-west:W`;

  return `${Math.abs(latitude).toFixed(2)}° ${latitude < 0 ? south : north}, ${Math.abs(longitude).toFixed(2)}° ${
    longitude < 0 ? west : east
  }`;
}

/** A fleet operation step for people (3.38 D7; the backend's step keys), unknown keys stay as they are. */
export function fleetStepLabel(key: string): string {
  switch (key) {
    case 'validate':
      return $localize`:@@lwConsoleFleetOps-stepValidate:Validate`;
    case 'transfer':
      return $localize`:@@lwConsoleFleetOps-stepTransfer:Transfer the backup`;
    case 'deployment-plan':
      return $localize`:@@lwConsoleFleetOps-stepDeploymentPlan:Plan the deployment`;
    case 'deployment-apply':
      return $localize`:@@lwConsoleFleetOps-stepDeploymentApply:Apply the deployment`;
    case 'restore-plan':
      return $localize`:@@lwConsoleFleetOps-stepRestorePlan:Plan the restore`;
    case 'restore-apply':
      return $localize`:@@lwConsoleFleetOps-stepRestoreApply:Apply the restore`;
    case 'restore-wait':
      return $localize`:@@lwConsoleFleetOps-stepRestoreWait:Wait for the restore`;
    case 'platform-postgres':
      return $localize`:@@lwConsoleFleetOps-stepPostgres:Back up Postgres`;
    case 'platform-opensearch':
      return $localize`:@@lwConsoleFleetOps-stepOpensearch:Back up OpenSearch`;
    case 'platform-etcd':
      return $localize`:@@lwConsoleFleetOps-stepEtcd:Back up etcd`;
    case 'volumes':
      return $localize`:@@lwConsoleFleetOps-stepVolumes:Back up the volumes`;
    case 'volumes-wait':
      return $localize`:@@lwConsoleFleetOps-stepVolumesWait:Wait for the volume backups`;
    case 'copies':
      return $localize`:@@lwConsoleFleetOps-stepCopies:Copy to the backup targets`;
    default:
      return key;
  }
}

const AUDIT_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * A fleet audit target as people read it (D11, LW-26): `cluster/<id>[/api/<path>|/socket/<ns>]` → the cluster's name
 * (and the relayed path), `operation/<id>` → "Operation", `identity/key/<kid>` → "Identity key"; ids left in the path
 * become `…` (the raw target stays in the row details and the search).
 */
export function fleetAuditTarget(target: string, clusterName: (id: string) => string): string {
  const cluster = /^cluster\/([0-9a-f-]{36})(?:\/(api|socket)\/(.*))?$/i.exec(target);

  if (cluster) {
    const name = clusterName(cluster[1]);

    return cluster[3] ? `${name} › ${cluster[3].replace(AUDIT_UUID, '…')}` : name;
  }

  if (/^operation\/[0-9a-f-]{36}$/i.test(target)) return $localize`:@@lwConsoleFleetAudit-targetOperation:Operation`;

  if (target.startsWith('identity/key/')) return $localize`:@@lwConsoleFleetAudit-targetIdentityKey:Identity key`;

  return target.replace(AUDIT_UUID, '…');
}
