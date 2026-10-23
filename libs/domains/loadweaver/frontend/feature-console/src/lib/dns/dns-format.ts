import type { DnsRecordResource, DnsZoneRow } from '@forepath/loadweaver/frontend/data-access-console';

/** `www.example.com` from the relative record name and the zone's domain (`@` is the apex). */
export function recordFqdn(name: string, zoneDomain: string): string {
  return name === '@' ? zoneDomain : `${name}.${zoneDomain}`;
}

export type RecordSyncState = 'synced' | 'pending' | 'failing' | 'conflict' | 'unknown';

/**
 * A declared record's state at its zone's providers: a conflict when its name is owned by someone else, failing when
 * a provider sync fails, synced once every provider synced, unknown without the zone state (project members).
 */
export function recordSyncState(
  record: DnsRecordResource,
  row: DnsZoneRow | null,
  zoneDomain: string,
): RecordSyncState {
  if (!row) return 'unknown';

  const fqdn = recordFqdn(record.spec.name, zoneDomain);
  const names = new Set([record.spec.name, fqdn, `${fqdn}.`]);

  if (row.statuses.some((s) => s.conflicts.some((c) => names.has(c)))) return 'conflict';

  if (row.failing) return 'failing';

  if (row.statuses.length > 0 && row.statuses.every((s) => !!s.syncedAt)) return 'synced';

  return 'pending';
}

export const SYNC_TONE: Record<RecordSyncState, 'success' | 'warning' | 'danger' | 'secondary' | 'info'> = {
  synced: 'success',
  pending: 'info',
  failing: 'danger',
  conflict: 'warning',
  unknown: 'secondary',
};

export function syncLabel(state: RecordSyncState): string {
  switch (state) {
    case 'synced':
      return $localize`:@@lwConsoleDns-synced:Synced`;
    case 'pending':
      return $localize`:@@lwConsoleDns-pending:Not synced yet`;
    case 'failing':
      return $localize`:@@lwConsoleDns-failing:Sync failing`;
    case 'conflict':
      return $localize`:@@lwConsoleDns-conflict:Owned by someone else`;
    default:
      return $localize`:@@lwConsoleDns-unknown:Sync state not visible`;
  }
}
