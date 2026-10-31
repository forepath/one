import type { Plan } from './plans.types';
import type { TopologyGraph } from './topology.types';

/** Workspace drafts (3.36): `POST /drafts`, `GET /drafts[/{id}]`, `PATCH /drafts/{id}`, preview / submit / discard. */
export type DraftStatus = 'open' | 'submitted' | 'discarded';

/** One op of a draft: upsert a resource (one YAML document) or delete one; one per resource key. */
export interface DraftOp {
  op: 'upsert' | 'delete';
  kind: string;
  name: string;
  project: string | null;
  document?: string;
  /** The resource generation the op was based on (0 = didn't exist). */
  baseGeneration: number;
  by: string;
  at: string;
}

/** An op as the console sends it. */
export interface DraftOpInput {
  op: 'upsert' | 'delete';
  document?: string;
  kind?: string;
  name?: string;
  project?: string;
  baseGeneration?: number;
}

export interface Draft {
  id: string;
  title: string;
  owner: string;
  /** The owner's email (list / detail; D11), `null` for the API key, system or a deleted user. */
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

export interface DraftConflict {
  key: string;
  kind: string;
  name: string;
  project: string | null;
  baseGeneration: number;
  /** 0 = deleted since. */
  currentGeneration: number;
}

/** `POST /drafts/{id}/preview`: the dry-run plan, the map with its overlay, the conflicting ops. */
export interface DraftPreview {
  version: number;
  plan: Plan & { dryRun?: true };
  topology: TopologyGraph;
  conflicts: DraftConflict[];
}

export interface DraftPatchRequest {
  title?: string;
  set?: DraftOpInput[];
  /** Op keys `Kind/project/name`. */
  remove?: string[];
}

/** `socket/plans`: `draftsSnapshot` on connect, `draftPatch` for every change of a draft the user may edit. */
export interface DraftsSnapshotEvent {
  drafts: Draft[];
}

export interface DraftPatchEvent {
  draft: Draft;
}
