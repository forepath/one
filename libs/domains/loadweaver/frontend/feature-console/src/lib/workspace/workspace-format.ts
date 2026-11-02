import type { FpcTableState } from '@forepath/shared/frontend/ui-components';

import { kindIcon } from '../resources/resource-format';

/** Icons of Workspace item types (resource kinds reuse the resources view's icons). */
const TYPE_ICONS: Record<string, string> = {
  Site: 'bi-geo-alt',
  Node: 'bi-hdd-rack',
  Service: 'bi-boxes',
  Replica: 'bi-box',
  VirtualMachine: 'bi-pc-display',
  Volume: 'bi-database',
  WorkloadGroup: 'bi-collection',
  Hostname: 'bi-globe2',
  Address: 'bi-signpost',
  External: 'bi-cloud',
  Policy: 'bi-shield-check',
  Deployment: 'bi-stack',
};

export function workspaceKindIcon(typeName: string): string {
  return TYPE_ICONS[typeName] ?? kindIcon(typeName);
}

/** Glyph of a health / runtime status (the leading `fpc-status-badge`, 3.38 R10). */
export function workspaceHealthIcon(status: string): string {
  switch (workspaceHealthTone(status)) {
    case 'success':
      return 'bi-check-lg';
    case 'warning':
      return 'bi-exclamation';
    case 'danger':
      return 'bi-x-lg';
    case 'info':
      return 'bi-hourglass-split';
    default:
      return 'bi-question';
  }
}

/** Translated label of a health / runtime status (sentence case; unknown values pass through). */
export function workspaceHealthLabel(status: string): string {
  switch (status) {
    case 'healthy':
      return $localize`:@@lwConsoleHealth-healthy:Healthy`;
    case 'degraded':
      return $localize`:@@lwConsoleHealth-degraded:Degraded`;
    case 'failed':
      return $localize`:@@lwConsoleHealth-failed:Failed`;
    case 'unknown':
      return $localize`:@@lwConsoleHealth-unknown:Unknown`;
    case 'running':
      return $localize`:@@lwConsoleWorkspace-healthRunning:Running`;
    case 'warning':
      return $localize`:@@lwConsoleWorkspace-healthWarning:Warning`;
    case 'draining':
      return $localize`:@@lwConsoleWorkspace-healthDraining:Draining`;
    case 'critical':
      return $localize`:@@lwConsoleWorkspace-healthCritical:Critical`;
    case 'unhealthy':
      return $localize`:@@lwConsoleWorkspace-healthUnhealthy:Unhealthy`;
    case 'starting':
      return $localize`:@@lwConsoleWorkspace-healthStarting:Starting`;
    case 'pending':
      return $localize`:@@lwConsoleWorkspace-healthPending:Pending`;
    default:
      return status;
  }
}

/** Badge colour of a health / runtime status. */
export function workspaceHealthTone(status: string): 'success' | 'warning' | 'danger' | 'secondary' | 'info' {
  switch (status) {
    case 'healthy':
    case 'running':
      return 'success';
    case 'degraded':
    case 'warning':
    case 'draining':
      return 'warning';
    case 'critical':
    case 'unhealthy':
    case 'failed':
      return 'danger';
    case 'starting':
    case 'pending':
      return 'info';
    default:
      return 'secondary';
  }
}

/** A health / runtime status as the State column of a data table (3.38 D1 / D9). */
export function workspaceHealthState(status: string | null | undefined): FpcTableState | null {
  if (!status) return null;

  const tone = workspaceHealthTone(status);

  return {
    label: workspaceHealthLabel(status),
    tone: tone === 'secondary' ? 'neutral' : tone,
    icon: workspaceHealthIcon(status).replace(/^bi-/, ''),
  };
}
