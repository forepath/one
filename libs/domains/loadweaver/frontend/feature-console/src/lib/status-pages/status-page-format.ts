import type {
  AccessMe,
  Incident,
  IncidentStatus,
  StatusPageResource,
} from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcBadgeColor } from '@forepath/shared/frontend/ui-components';

export const INCIDENT_STATUS_TONE: Record<IncidentStatus, FpcBadgeColor> = {
  investigating: 'danger',
  identified: 'warning',
  monitoring: 'info',
  resolved: 'success',
};

export function incidentStatusLabel(status: IncidentStatus): string {
  switch (status) {
    case 'investigating':
      return $localize`:@@lwConsoleStatusPages-investigating:Investigating`;
    case 'identified':
      return $localize`:@@lwConsoleStatusPages-identified:Identified`;
    case 'monitoring':
      return $localize`:@@lwConsoleStatusPages-monitoring:Monitoring`;
    default:
      return $localize`:@@lwConsoleStatusPages-resolved:Resolved`;
  }
}

/** Operators and admins of the project write incident notes; cluster admins act as project admins everywhere. */
export function mayWriteIncidents(me: AccessMe | null, project: string | null): boolean {
  if (!me || !project) return false;

  if (me.clusterRole === 'cluster-admin') return true;

  const role = me.projects[project];

  return role === 'operator' || role === 'admin';
}

/** Project admins (and cluster admins) plan `StatusPage` resources like any other. */
export function mayPlanStatusPages(me: AccessMe | null, project: string | null): boolean {
  if (!me || !project) return false;

  if (me.clusterRole === 'cluster-admin') return true;

  const role = me.projects[project];

  return role === 'developer' || role === 'operator' || role === 'admin';
}

/** The public page: served on its own hostname over HTTPS. */
export function statusPageUrl(page: StatusPageResource): string {
  return `https://${page.spec.host}/`;
}

/** The newest update (the incident's current note). */
export function latestUpdate(incident: Incident): Incident['updates'][number] | null {
  return incident.updates.length > 0 ? incident.updates[incident.updates.length - 1] : null;
}

/** Open incidents first, then newest first. */
export function sortIncidents(incidents: readonly Incident[]): Incident[] {
  return [...incidents].sort(
    (a, b) =>
      Number(a.status === 'resolved') - Number(b.status === 'resolved') || b.createdAt.localeCompare(a.createdAt),
  );
}
