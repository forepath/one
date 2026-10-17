import type { ClusterRole } from '../entities/cluster-member.entity';
import { PROJECT_ROLES, type ApprovalMode, type ProjectRole } from '../entities/project-access.entity';

/** Who is asking, with every role they hold (3.17). */
export interface AccessCaller {
  userId?: string;
  isApiKey: boolean;
  /** Global admins (interactive) and the static API key are cluster admins. */
  clusterRole?: ClusterRole;
  projects: ReadonlyMap<string, ProjectRole>;
}

const RANK: Record<ProjectRole, number> = Object.fromEntries(PROJECT_ROLES.map((r, i) => [r, i])) as Record<
  ProjectRole,
  number
>;

export function atLeast(role: ProjectRole | undefined, minimum: ProjectRole): boolean {
  return !!role && RANK[role] >= RANK[minimum];
}

/** The caller's role in a project: cluster admins act as project admins everywhere. */
export function projectRole(caller: AccessCaller, project: string): ProjectRole | undefined {
  return caller.clusterRole === 'cluster-admin' ? 'admin' : caller.projects.get(project);
}

/** Project data (resources, plans, map): members, auditors and infra operators (who manage the nodes it runs on). */
export function canReadProject(caller: AccessCaller, project: string): boolean {
  return !!projectRole(caller, project) || caller.clusterRole === 'auditor' || caller.clusterRole === 'infra-operator';
}

/** Logs, terminals' recordings, secrets metadata: members, cluster admins and auditors — not infra operators. */
export function canReadProjectSensitive(caller: AccessCaller, project: string): boolean {
  return !!projectRole(caller, project) || caller.clusterRole === 'auditor';
}

/**
 * Who may grant what (Agenstra's rules): cluster admins and the project's creator assign any role; project admins
 * assign operators, developers and viewers, and can't change or remove another admin.
 */
export function mayGrant(
  caller: AccessCaller,
  project: string,
  creator: string | null,
  role: ProjectRole | null,
  current: ProjectRole | undefined,
): boolean {
  if (caller.clusterRole === 'cluster-admin' || (!!caller.userId && caller.userId === creator)) return true;

  if (projectRole(caller, project) !== 'admin') return false;

  return role !== 'admin' && current !== 'admin';
}

/** Kinds only cluster admins change: the cluster itself and projects (with their quotas). */
const ADMIN_KINDS = new Set(['Cluster', 'Project']);

export interface PlanRequirements {
  /** Cluster permission for cluster-level changes. */
  cluster?: 'admin' | 'infra';
  /** Projects whose resources change. */
  projects: string[];
}

export function planRequirements(
  changes: readonly { action: string; kind: string; project: string | null }[],
): PlanRequirements {
  const touched = changes.filter((c) => c.action !== 'unchanged');
  const cluster = touched.filter((c) => c.project === null);

  return {
    ...(cluster.length > 0 ? { cluster: cluster.some((c) => ADMIN_KINDS.has(c.kind)) ? 'admin' : 'infra' } : {}),
    projects: [...new Set(touched.flatMap((c) => (c.project ? [c.project] : [])))].sort(),
  };
}

/** A plan is visible to whoever may read everything it touches. */
export function planVisibleTo(
  caller: AccessCaller,
  changes: readonly { action: string; kind: string; project: string | null }[],
): boolean {
  const requirements = planRequirements(changes);

  return (
    (!requirements.cluster || !!caller.clusterRole) && requirements.projects.every((p) => canReadProject(caller, p))
  );
}

/** Whether a project's part of a plan needs an approval before it's applied (3.17). */
export function approvalNeeded(mode: ApprovalMode, creatorRole: ProjectRole | undefined, risky: boolean): boolean {
  return mode === 'everyone' || (mode === 'risky' && risky) || !atLeast(creatorRole, 'operator');
}

/** An approval counts if it comes from an operator / admin of the project who didn't create the plan. */
export function validApproval(
  approver: { userId: string; role: ProjectRole | undefined },
  creator: string | null,
): boolean {
  return atLeast(approver.role, 'operator') && approver.userId !== creator;
}
