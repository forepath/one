import { atLeast, planRequirements, projectRole, type AccessCaller } from '../access/access.utils';
import type { RequestWithUser } from '@forepath/identity/backend';

import { actorFromRequest } from '../services/audit-log.service';
import type { DraftEntity, DraftOp, DraftStatus } from './draft.entity';

/** Limits per draft / owner (3.36). */
export const MAX_DRAFT_OPS = 500;
export const MAX_DRAFT_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_OPEN_DRAFTS_PER_OWNER = 100;

export interface DraftRef {
  kind: string;
  name: string;
  project: string | null;
}

/** The resource key of an op: `Kind/project/name` (empty project for cluster-level kinds). */
export function draftOpKey(ref: DraftRef): string {
  return `${ref.kind}/${ref.project ?? ''}/${ref.name}`;
}

/** Applies a patch: `set` ops replace the op of the same key (newest wins), `remove` keys drop theirs. */
export function applyDraftPatch(
  ops: readonly DraftOp[],
  patch: { set?: readonly DraftOp[]; remove?: readonly string[] },
): DraftOp[] {
  const byKey = new Map(ops.map((o) => [draftOpKey(o), o] as const));

  for (const key of patch.remove ?? []) byKey.delete(key);

  for (const op of patch.set ?? []) byKey.set(draftOpKey(op), op);

  return [...byKey.values()];
}

/** What the ops touch, as a plan would (3.17): projects and the cluster permission. */
export function draftScope(ops: readonly (DraftRef & { op?: string })[]): {
  projects: string[];
  clusterScope: 'infra' | 'admin' | null;
} {
  const requirements = planRequirements(
    ops.map((o) => ({
      action: o.op === 'delete' ? 'delete' : 'update',
      kind: o.kind,
      project: o.project,
    })),
  );

  return { projects: requirements.projects, clusterScope: requirements.cluster ?? null };
}

/** Whether the caller holds the cluster permission (`infra` / `admin`) a draft's cluster-level ops need. */
function hasClusterScope(caller: AccessCaller, scope: 'infra' | 'admin'): boolean {
  return caller.clusterRole === 'cluster-admin' || (scope === 'infra' && caller.clusterRole === 'infra-operator');
}

/** Whether the caller may plan everything in a scope (developer+ on every project, the cluster permission). */
export function mayPlanScope(
  caller: AccessCaller,
  scope: { projects: readonly string[]; clusterScope: 'infra' | 'admin' | null },
): boolean {
  return (
    (!scope.clusterScope || hasClusterScope(caller, scope.clusterScope)) &&
    scope.projects.every((p) => atLeast(projectRole(caller, p), 'developer'))
  );
}

/**
 * Who may see and edit a draft (3.36): its owner, and everyone who may plan all of it — write (developer or higher)
 * on every touched project and the cluster permission its cluster-level ops need. An empty draft is the owner's only.
 */
export function mayEditDraft(
  caller: AccessCaller,
  actor: string,
  draft: Pick<DraftEntity, 'owner' | 'projects' | 'clusterScope'>,
): boolean {
  if (draft.owner === actor) return true;

  if (draft.projects.length === 0 && !draft.clusterScope) return false;

  return mayPlanScope(caller, draft);
}

export interface DraftConflict {
  key: string;
  kind: string;
  name: string;
  project: string | null;
  baseGeneration: number;
  /** 0 = the resource no longer exists. */
  currentGeneration: number;
}

/** Ops whose base generation is no longer the resource's (changed, created or deleted since). */
export function draftConflicts(ops: readonly DraftOp[], current: ReadonlyMap<string, number>): DraftConflict[] {
  return ops.flatMap((o) => {
    const key = draftOpKey(o);
    const generation = current.get(key) ?? 0;

    return generation === o.baseGeneration
      ? []
      : [
          {
            key,
            kind: o.kind,
            name: o.name,
            project: o.project,
            baseGeneration: o.baseGeneration,
            currentGeneration: generation,
          },
        ];
  });
}

/** The `POST /plans` body for a draft: upserts as one multi-document YAML bundle, deletions as references. */
export function draftPlanInput(ops: readonly DraftOp[]): {
  documents?: string;
  delete?: { kind: string; name: string; project?: string }[];
} {
  const upserts = ops.filter((o) => o.op === 'upsert' && o.document);
  const deletions = ops.filter((o) => o.op === 'delete');

  return {
    ...(upserts.length
      ? {
          documents:
            upserts.map((o) => (o.document as string).replace(/^---\s*\n/, '').trimEnd()).join('\n---\n') + '\n',
        }
      : {}),
    ...(deletions.length
      ? {
          delete: deletions.map((o) => ({ kind: o.kind, name: o.name, ...(o.project ? { project: o.project } : {}) })),
        }
      : {}),
  };
}

/** Total size of a draft's documents in bytes. */
export function draftDocumentBytes(ops: readonly DraftOp[]): number {
  return ops.reduce((sum, o) => sum + (o.document ? Buffer.byteLength(o.document, 'utf8') : 0), 0);
}

/** `If-Match: "3"` / `3` / `W/"3"` → 3; anything else → null. */
export function parseIfMatch(header: string | string[] | undefined): number | null {
  const value = Array.isArray(header) ? header[0] : header;
  const match = value?.trim().match(/^(?:W\/)?"?(\d{1,9})"?$/);

  return match ? Number(match[1]) : null;
}

export interface DraftResponseDto {
  id: string;
  title: string;
  owner: string;
  /**
   * The owner's email (D11: the console shows people by email, not by id) on `GET /drafts` and `GET /drafts/:id`;
   * `null` for the API key / system, a deleted user or when not resolved (writes, socket events).
   */
  ownerEmail?: string | null;
  projects: string[];
  clusterScope: 'infra' | 'admin' | null;
  ops: DraftOp[];
  version: number;
  status: DraftStatus;
  planId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toDraftResponse(d: DraftEntity, ownerEmail?: string | null): DraftResponseDto {
  return {
    id: d.id,
    title: d.title,
    owner: d.owner,
    ...(ownerEmail !== undefined ? { ownerEmail } : {}),
    projects: d.projects ?? [],
    clusterScope: d.clusterScope ?? null,
    ops: d.ops ?? [],
    version: d.version,
    status: d.status,
    planId: d.planId ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

/** The acting person a draft records: a verified fleet person (3.24), the user, or the API key. */
export function draftActor(req?: RequestWithUser): string {
  const actor = actorFromRequest(req);

  return actor.person ?? actor.id ?? actor.type;
}
