import type { AuditQuery, Plan } from '@forepath/loadweaver/frontend/data-access-console';

import type { ResourceObjectRef } from './resources-context.service';

/** Per-object Task history (3.37): what the audit log is asked for, and which plans touch the object. */
export interface ObjectHistoryTarget {
  /** `GET /audit` filter (target prefix, else full text + project). */
  audit: AuditQuery;
  /** The resource kind / name / project plans change (null for the cluster: every plan). */
  resource: { kind: string; name: string; project: string | null } | null;
  /** Project filter for `GET /plans`. */
  project: string | null;
}

const AUDIT_LIMIT = 100;

/** Audit target prefixes of objects with their own runtime audit entries. */
function auditTarget(kind: string, project: string | null, name: string): string | null {
  switch (kind) {
    case 'node':
      return `node/${name}`;
    case 'virtualmachine':
      return project ? `virtual-machine/${project}/${name}` : null;
    case 'dnszone':
      return `dns-zone/${name}`;
    case 'dnsfailover':
      return `dns-failover/${name}`;
    default:
      return null;
  }
}

/** The history query of an object (`kind` as the URL has it; `resourceKind` = its real resource kind). */
export function objectHistoryTarget(ref: ResourceObjectRef, resourceKind: string): ObjectHistoryTarget {
  if (ref.kind === 'cluster' || !ref.name) return { audit: { limit: AUDIT_LIMIT }, resource: null, project: null };

  if (ref.kind === 'project')
    return {
      audit: { limit: AUDIT_LIMIT, project: ref.name },
      resource: null,
      project: ref.name,
    };

  const target = auditTarget(ref.kind, ref.project, ref.name);

  return {
    audit: target
      ? { limit: AUDIT_LIMIT, target }
      : { limit: AUDIT_LIMIT, text: ref.name, ...(ref.project ? { project: ref.project } : {}) },
    resource: { kind: resourceKind, name: ref.name, project: ref.project },
    project: ref.project,
  };
}

/** Plans that change the object (client filter over `changes`; all plans for scopes without a resource). */
export function plansTouching(plans: readonly Plan[], target: ObjectHistoryTarget): Plan[] {
  const resource = target.resource;

  if (!resource) return [...plans];

  return plans.filter((plan) =>
    plan.changes.some(
      (change) =>
        change.kind === resource.kind &&
        change.name === resource.name &&
        (change.project ?? null) === (resource.project ?? null),
    ),
  );
}
