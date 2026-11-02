import { HttpErrorResponse } from '@angular/common/http';
import type {
  AccessMe,
  PlanResourceRef,
  SecretSummary,
  SecretUsage,
} from '@forepath/loadweaver/frontend/data-access-console';

import { atLeastRole, projectRoleOf } from '../access/access-format';
import { SCHEMA_KIND_LABELS } from '../objects/schema-form-labels';

/**
 * A secret name as the console accepts it before asking the cluster (the cluster validates again; the fleet relay
 * accepts the same characters in the path).
 */
export const SECRET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;

/** Platform-reserved names (volume keys, …): cluster admins only. */
export const RESERVED_SECRET_PREFIX = 'lw-';

/** `secret://<project>/<name>`: how resources reference a secret. */
export function secretReference(secret: Pick<SecretSummary, 'project' | 'name'>): string {
  return `secret://${secret.project}/${secret.name}`;
}

/** Row id of a secret in the cluster-wide list. */
export function secretId(secret: Pick<SecretSummary, 'project' | 'name'>): string {
  return `${secret.project}/${secret.name}`;
}

function isClusterAdmin(me: AccessMe | null | undefined): boolean {
  return me?.clusterRole === 'cluster-admin';
}

/**
 * Who may list and write a project's secrets (3.40): project admins / operators of it and cluster admins (fleet: the
 * grant-mapped role); `null` = any project (the cluster-wide page). The cluster decides again per request.
 */
export function mayManageSecrets(me: AccessMe | null | undefined, project: string | null): boolean {
  if (!me) return false;

  if (project) return atLeastRole(projectRoleOf(me, project), 'operator');

  return (
    isClusterAdmin(me) ||
    atLeastRole(me.allProjects ?? null, 'operator') ||
    Object.values(me.projects).some((role) => atLeastRole(role, 'operator'))
  );
}

/** Names the caller may write: `lw-` names only for cluster admins. */
export function mayWriteSecretName(me: AccessMe | null | undefined, name: string): boolean {
  return !name.startsWith(RESERVED_SECRET_PREFIX) || isClusterAdmin(me);
}

/** Projects the caller may add secrets to (`all`: every project the cluster lists, for cluster admins). */
export function secretProjects(me: AccessMe | null | undefined, all: readonly string[]): string[] {
  if (!me) return [];

  const candidates =
    isClusterAdmin(me) || me.allProjects ? [...all, ...Object.keys(me.projects)] : Object.keys(me.projects);

  return [...new Set(candidates)].filter((project) => mayManageSecrets(me, project)).sort();
}

/** Resources still running an older version than the current one (null pins = not applied yet: they get the current). */
export function staleUsages(secret: Pick<SecretSummary, 'version' | 'usedBy'>): SecretUsage[] {
  return secret.usedBy.filter((usage) => usage.pinnedVersion !== null && usage.pinnedVersion !== secret.version);
}

/** The `refresh` list of the Roll out plan: each stale resource once. */
export function rolloutRefs(usages: readonly SecretUsage[]): PlanResourceRef[] {
  const seen = new Set<string>();
  const refs: PlanResourceRef[] = [];

  for (const usage of usages) {
    const key = `${usage.kind}/${usage.project}/${usage.name}`;

    if (seen.has(key)) continue;

    seen.add(key);
    refs.push({ kind: usage.kind, name: usage.name, project: usage.project });
  }

  return refs;
}

const GIT_CONNECTION_LABEL = $localize`:@@lwConsoleSecrets-usageGit:Git connection`;

/**
 * `Deployment shop/api` with the readable kind (and the pinned version when it differs from `current`); a project's
 * Git connection (one per project, named by its id) as `Git connection (shop)`.
 */
export function usageLabel(usage: SecretUsage, current?: number): string {
  const base =
    usage.kind === 'GitConnection'
      ? `${GIT_CONNECTION_LABEL} (${usage.project})`
      : `${SCHEMA_KIND_LABELS[usage.kind] ?? usage.kind} ${usage.project}/${usage.name}`;

  return usage.pinnedVersion !== null && current !== undefined && usage.pinnedVersion !== current
    ? `${base} (v${usage.pinnedVersion})`
    : base;
}

/** The referencing resources of a `409` (secret still in use), else null. */
export function inUseUsages(error: unknown): SecretUsage[] | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) return null;

  const usedBy = (error.error as { usedBy?: unknown } | null)?.usedBy;

  return Array.isArray(usedBy) ? (usedBy as SecretUsage[]) : [];
}

/** Free-text filter over name, project, reference and the referencing resources. */
export function filterSecrets(secrets: readonly SecretSummary[], query: string): SecretSummary[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (terms.length === 0) return [...secrets];

  return secrets.filter((secret) => {
    const text = [
      secret.name,
      secret.project,
      secretReference(secret),
      secret.updatedBy ?? '',
      ...secret.usedBy.map((usage) => usageLabel(usage)),
    ]
      .join(' ')
      .toLowerCase();

    return terms.every((term) => text.includes(term));
  });
}
