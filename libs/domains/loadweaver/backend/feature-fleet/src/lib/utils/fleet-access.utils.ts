import { FLEET_ROLES, type FleetClusterState, type FleetRole } from '../constants/fleet.constants';

/** Who is asking at the fleet. */
export interface FleetCaller {
  userId: string | null;
  isApiKey: boolean;
  /** Global admins (and the static API key) are admins of every cluster. */
  isAdmin: boolean;
  /** Label forwarded to clusters as on-behalf-of (`fleet:<email or id>`). */
  label: string;
}

export interface FleetGrantLike {
  role: FleetRole;
  project: string | null;
}

export interface FleetClusterAccessState {
  state: FleetClusterState;
  readOnlyUntil: Date | null;
}

/** Effective access of a caller to one cluster. */
export interface FleetClusterAccess {
  /** Cluster-wide role, or null (project grants only / no access). */
  clusterRole: FleetRole | null;
  /** Project roles above the cluster-wide role. */
  projects: ReadonlyMap<string, FleetRole>;
  /** Read-only grace (Loadweaver Cloud teardown): every role is capped at viewer. */
  readOnly: boolean;
}

const RANK: Record<FleetRole, number> = { viewer: 0, operator: 1, admin: 2 };

export function isFleetRole(value: unknown): value is FleetRole {
  return typeof value === 'string' && (FLEET_ROLES as readonly string[]).includes(value);
}

export function roleAtLeast(role: FleetRole | null | undefined, minimum: FleetRole): boolean {
  return !!role && RANK[role] >= RANK[minimum];
}

export function maxRole(a: FleetRole | null | undefined, b: FleetRole | null | undefined): FleetRole | null {
  if (!a) return b ?? null;

  if (!b) return a;

  return RANK[a] >= RANK[b] ? a : b;
}

function cap(role: FleetRole | null, readOnly: boolean): FleetRole | null {
  return role && readOnly ? 'viewer' : role;
}

/** Grace access (section 4): `teardown` state or an explicit read-only window that has not ended. */
export function isReadOnly(cluster: FleetClusterAccessState, now = new Date()): boolean {
  return cluster.state === 'teardown' || (!!cluster.readOnlyUntil && cluster.readOnlyUntil.getTime() > now.getTime());
}

export const NO_ACCESS: FleetClusterAccess = { clusterRole: null, projects: new Map(), readOnly: false };

/**
 * Roles a caller holds on a cluster: admins everything; others the highest cluster-wide grant plus project grants
 * that go beyond it. Retired clusters are closed for everyone; grace caps all roles at viewer.
 */
export function clusterAccess(
  caller: FleetCaller,
  grants: readonly FleetGrantLike[],
  cluster: FleetClusterAccessState,
  now = new Date(),
): FleetClusterAccess {
  if (cluster.state === 'retired') return NO_ACCESS;

  const readOnly = isReadOnly(cluster, now);

  if (caller.isAdmin) return { clusterRole: cap('admin', readOnly), projects: new Map(), readOnly };

  let clusterRole: FleetRole | null = null;

  for (const grant of grants) if (grant.project === null) clusterRole = maxRole(clusterRole, grant.role);

  const projects = new Map<string, FleetRole>();

  for (const grant of grants) {
    if (grant.project === null) continue;

    const role = maxRole(projects.get(grant.project), grant.role);

    if (role && !roleAtLeast(clusterRole, role)) projects.set(grant.project, cap(role, readOnly) as FleetRole);
  }

  return { clusterRole: cap(clusterRole, readOnly), projects, readOnly };
}

/** The role for a request: the cluster-wide role, or the project's role when it is higher. */
export function roleFor(access: FleetClusterAccess, project?: string | null): FleetRole | null {
  return maxRole(access.clusterRole, project ? access.projects.get(project) : null);
}

export function hasAnyAccess(access: FleetClusterAccess): boolean {
  return !!access.clusterRole || access.projects.size > 0;
}
