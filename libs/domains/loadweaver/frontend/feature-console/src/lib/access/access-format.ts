import type {
  AccessMe,
  ApprovalMode,
  ClusterRole,
  ProjectRole,
  ProjectSettings,
} from '@forepath/loadweaver/frontend/data-access-console';

import { saveFile } from '../live/live-format';

const PROJECT_RANK: Record<ProjectRole, number> = { viewer: 0, developer: 1, operator: 2, admin: 3 };

/** The caller's role in a project: cluster admins act as project admins everywhere (like the API). */
export function projectRoleOf(me: AccessMe | null | undefined, project: string | null | undefined): ProjectRole | null {
  if (!me || !project) return null;

  return me.clusterRole === 'cluster-admin' ? 'admin' : (me.projects[project] ?? me.allProjects ?? null);
}

/**
 * Whether approvals / acceptances can be given here (3.24): always in a cluster's own console; in fleet mode only
 * when the active cluster verifies this fleet's identity claims (else the cluster's own console, `nativeUrl`).
 */
export function approvalsAvailable(fleetMode: boolean, me: AccessMe | null | undefined): boolean {
  return !fleetMode || !!me?.fleetApprovals;
}

/**
 * Whether search favourites can be used (2026-10-27): always natively; in fleet mode only when the active cluster
 * verifies this fleet's per-user claims (the favourites are then the person's, never the fleet's service account's).
 */
export function favouritesAvailable(fleetMode: boolean, me: AccessMe | null | undefined): boolean {
  return !fleetMode || !!me?.fleetIdentity;
}

export function atLeastRole(role: ProjectRole | null, minimum: ProjectRole): boolean {
  return !!role && PROJECT_RANK[role] >= PROJECT_RANK[minimum];
}

/** Any cluster or project role: who gets the access view. */
export function hasAnyRole(me: AccessMe | null | undefined): boolean {
  return !!me && (!!me.clusterRole || Object.keys(me.projects).length > 0);
}

/** Cluster admins and project admins: who may manage wallboard tokens. */
export function administersSomething(me: AccessMe | null | undefined): boolean {
  return !!me && (me.clusterRole === 'cluster-admin' || Object.values(me.projects).includes('admin'));
}

/** Project admins grant roles below admin; cluster admins and the project's creator also manage admins. */
export function mayGrantProjectAdmin(me: AccessMe | null | undefined, settings: ProjectSettings | null): boolean {
  return !!me && (me.clusterRole === 'cluster-admin' || (!!me.userId && me.userId === settings?.createdBy));
}

export function clusterRoleLabel(role: ClusterRole): string {
  switch (role) {
    case 'cluster-admin':
      return $localize`:@@lwConsoleAccess-roleClusterAdmin:Cluster admin`;
    case 'infra-operator':
      return $localize`:@@lwConsoleAccess-roleInfraOperator:Infra operator`;
    default:
      return $localize`:@@lwConsoleAccess-roleAuditor:Auditor`;
  }
}

export function projectRoleLabel(role: ProjectRole): string {
  switch (role) {
    case 'admin':
      return $localize`:@@lwConsoleAccess-roleAdmin:Admin`;
    case 'operator':
      return $localize`:@@lwConsoleAccess-roleOperator:Operator`;
    case 'developer':
      return $localize`:@@lwConsoleAccess-roleDeveloper:Developer`;
    default:
      return $localize`:@@lwConsoleAccess-roleViewer:Viewer`;
  }
}

export function roleColor(role: ProjectRole | ClusterRole): 'danger' | 'warning' | 'primary' | 'secondary' {
  switch (role) {
    case 'admin':
    case 'cluster-admin':
      return 'danger';
    case 'operator':
    case 'infra-operator':
      return 'warning';
    case 'developer':
      return 'primary';
    default:
      return 'secondary';
  }
}

export function approvalModeLabel(mode: ApprovalMode): string {
  switch (mode) {
    case 'everyone':
      return $localize`:@@lwConsoleAccess-approvalEveryone:Every plan (four eyes)`;
    case 'risky':
      return $localize`:@@lwConsoleAccess-approvalRisky:Developer and risky plans`;
    default:
      return $localize`:@@lwConsoleAccess-approvalDevelopers:Developer plans`;
  }
}

/** Downloads text as a file (the access export). */
export function downloadText(doc: Document, fileName: string, text: string): void {
  saveFile(doc, text, fileName);
}
