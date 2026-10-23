/** The audit log (3.18): `GET /audit`, `GET /audit/export`, `GET /cluster/audit/verify`. */

/** One hash-chained entry. */
export interface AuditEntry {
  /** Sequence number (a bigint as a string). */
  seq: string;
  at: string;
  actorType: string;
  actorId: string | null;
  action: string;
  target: string;
  project: string | null;
  details: Record<string, unknown>;
  hash: string;
}

/** The filter of `GET /audit` (and its export). */
export interface AuditFilter {
  /** ISO times. */
  from?: string;
  to?: string;
  project?: string;
  /** Exact action or a prefix ending in `*` (`terminal.*`). */
  action?: string;
  /** Exact actor id. */
  actor?: string;
  /** Target prefix. */
  target?: string;
  /** Full text over action, target and details. */
  text?: string;
}

export interface AuditQuery extends AuditFilter {
  /** 1–500. */
  limit?: number;
  /** Entries with a lower sequence number (the previous page's `before`). */
  before?: string;
}

/** Newest first; `before` is the cursor of the next (older) page, `null` on the last. */
export interface AuditPage {
  entries: AuditEntry[];
  before: string | null;
}

export type AuditExportFormat = 'csv' | 'ndjson';

/** `GET /cluster/audit/verify` (auditors and cluster admins). */
export interface AuditVerification {
  ok: boolean;
  checked: number;
  /** First sequence number whose hash does not match. */
  brokenAt?: string;
  head?: string;
  anchors: {
    /** Anchors in the log store compared with the chain. */
    checked: number;
    /** Anchored entries whose hash differs: the chain was rewritten after the anchor. */
    mismatched: string[];
    available: boolean;
  };
}
