import {
  isFleetClusterId,
  type FleetCardCapacity,
  type FleetHealthState,
  type FleetOperation,
  type FleetOperationKind,
  type FleetOperationStatus,
  type FleetRole,
  type FleetStepStatus,
} from '@forepath/loadweaver/frontend/data-access-console';

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

export function fleetConnectionLabel(state: FleetHealthState | string): string {
  switch (state) {
    case 'healthy':
      return $localize`:@@lwConsoleFleet-connHealthy:Healthy`;
    case 'degraded':
      return $localize`:@@lwConsoleFleet-connDegraded:Degraded`;
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

export const FLEET_OPERATION_TONE: Record<FleetOperationStatus, Tone> = {
  running: 'primary',
  waiting: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'secondary',
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

export function fleetStepTone(status: FleetStepStatus): Tone {
  return status === 'pending' || status === 'skipped' ? 'secondary' : FLEET_OPERATION_TONE[status];
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

/** `CPU 40% · memory 62%` style shares; `null` without capacity data. */
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

  const path = match[2] && match[2] !== '/' ? match[2] : '/overview';

  return { clusterId: match[1], path: `${path}${match[3] ?? ''}` };
}

/**
 * Console routes the fleet's relay never carries (Git connections, the service user's personal resources — VPN
 * devices, linked Git accounts —, and the cluster's own admin features the console reaches outside `ConsoleApi`:
 * webhooks, release announcements): their pages show "not available through the fleet" in fleet mode, and the
 * sidebar hides them. Approvals stay native too (plan approve, cross-project acceptances): those actions are hidden.
 */
export const FLEET_UNAVAILABLE_PATHS: readonly string[] = [
  '/git',
  '/devices',
  '/settings/git-accounts',
  '/webhooks',
  '/updates/announcements',
];

/**
 * Items that need more than the console role suggests through the fleet: the relay carries the file browser, live
 * sessions' files and backup downloads only for the **admin** grant (cluster admin in console terms).
 */
export const FLEET_ADMIN_ONLY_PATHS: readonly string[] = ['/files'];

/** Routes of the fleet itself and the account (available without an active cluster). */
export const FLEET_LEVEL_PATHS: readonly string[] = ['/fleet', '/settings', '/users', '/clusters'];

function pathOf(url: string): string {
  return url.split(/[?#]/)[0].replace(/^\/(de|en)(?=\/|$)/, '') || '/';
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isFleetUnavailablePath(url: string): boolean {
  const path = pathOf(url);

  return FLEET_UNAVAILABLE_PATHS.some((prefix) => under(path, prefix));
}

export function isFleetLevelPath(url: string): boolean {
  const path = pathOf(url);

  return FLEET_LEVEL_PATHS.some((prefix) => under(path, prefix));
}

/** Equirectangular projection of a site onto the map's viewBox (`0 0 360 180`). */
export function projectSite(latitude: number, longitude: number): { x: number; y: number } {
  const lon = Math.max(-180, Math.min(180, longitude));
  const lat = Math.max(-90, Math.min(90, latitude));

  return { x: Math.round((lon + 180) * 10) / 10, y: Math.round((90 - lat) * 10) / 10 };
}
