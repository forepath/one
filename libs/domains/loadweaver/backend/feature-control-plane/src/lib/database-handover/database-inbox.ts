import { formatBytes, type DatabaseFenceRecord } from './database-handover.utils';

/** Inbox items about the cluster's database (kind `database`, 3.43 takeover); the overview adds the kind. */
export interface DatabaseInboxItem {
  kind: 'database';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  link: string;
  since?: string;
}

/** Where the database state is shown (`GET /api/cluster` → `controlPlane.database`, the cluster page). */
const DATABASE_LINK = '/resources/cluster';
/** Fence reports stay in the inbox this long (the exported rows are for review). */
export const FENCE_INBOX_MS = 7 * 24 * 3600_000;

export interface DatabaseInboxInput {
  location: 'external' | 'members' | null;
  readOnly: boolean;
  takenOverAt: string | null;
  /** Why the built-in control plane doesn't take over while read-only (null: it will, or it isn't read-only). */
  takeoverBlocked: string | null;
  fences: readonly DatabaseFenceRecord[];
}

/**
 * Critical while the built-in control plane runs on the database it took over (until a handover re-seeds the members)
 * and while it is read-only without being able to take over; a warning per fenced member for a week (its exported
 * rows wait for review, never merged).
 */
export function databaseInboxItems(input: DatabaseInboxInput, now: number): DatabaseInboxItem[] {
  const items: DatabaseInboxItem[] = [];

  if (input.location === 'external' && input.takenOverAt)
    items.push({
      kind: 'database',
      severity: 'critical',
      title:
        "the built-in control plane took over the cluster's database: no member's Postgres was primary; members that come back are fenced and re-seeded from it",
      link: DATABASE_LINK,
      since: input.takenOverAt,
    });

  if (input.readOnly && input.takeoverBlocked)
    items.push({
      kind: 'database',
      severity: 'critical',
      title: `the cluster's database is read-only: ${input.takeoverBlocked}`,
      link: DATABASE_LINK,
    });

  for (const fence of input.fences) {
    const at = Date.parse(fence.at);

    if (!Number.isFinite(at) || now - at > FENCE_INBOX_MS) continue;

    items.push({
      kind: 'database',
      severity: 'warning',
      title: fence.exportDir
        ? `member ${fence.node} held data from before the takeover: moved aside to ${fence.dataDir}; ${fence.exportRows ?? 0} row(s) written after the takeover exported to ${fence.exportDir} (${formatBytes(fence.exportBytes ?? 0)}) for review, not merged`
        : `member ${fence.node} held data from before the takeover: moved aside to ${fence.dataDir} and kept (no export of rows written after the takeover${fence.exportError ? `: ${fence.exportError}` : ''})`,
      link: DATABASE_LINK,
      since: fence.at,
    });
  }

  return items;
}
