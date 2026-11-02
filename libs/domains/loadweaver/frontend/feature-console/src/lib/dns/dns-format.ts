import type { DnsRecordResource, DnsZoneRow } from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcBadgeTone } from '@forepath/shared/frontend/ui-components';

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

export const SYNC_TONE: Record<RecordSyncState, FpcBadgeTone> = {
  synced: 'success',
  pending: 'info',
  failing: 'danger',
  conflict: 'warning',
  unknown: 'neutral',
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

/** A zone's state over its providers (3.38 D7): failing, names owned by others, synced everywhere, not synced yet. */
export function zoneSyncState(row: DnsZoneRow): RecordSyncState {
  if (row.failing) return 'failing';

  if (row.conflicts > 0) return 'conflict';

  if (row.statuses.length > 0 && row.statuses.every((s) => !!s.syncedAt)) return 'synced';

  return 'pending';
}

/** A zone's state label: a conflict on a zone means names at the provider Loadweaver leaves untouched. */
export function zoneSyncLabel(state: RecordSyncState): string {
  return state === 'conflict' ? $localize`:@@lwConsoleDns-zoneConflict:Names owned by others` : syncLabel(state);
}

/** DNSSEC signing mode (`null` = not signed yet). */
export function dnssecModeLabel(mode: 'signed' | 'insecure' | null): string {
  switch (mode) {
    case 'signed':
      return $localize`:@@lwConsoleDns-signed:Signed`;
    case 'insecure':
      return $localize`:@@lwConsoleDns-insecure:Going insecure`;
    default:
      return $localize`:@@lwConsoleDns-notSigned:Not signed yet`;
  }
}

export function dnssecModeTone(mode: 'signed' | 'insecure' | null): FpcBadgeTone {
  return mode === 'signed' ? 'success' : mode === 'insecure' ? 'warning' : 'neutral';
}

/** DNSSEC key state. */
export function dnssecKeyStateLabel(state: string): string {
  switch (state) {
    case 'active':
      return $localize`:@@lwConsoleDns-keyActive:Active`;
    case 'retired':
      return $localize`:@@lwConsoleDns-keyRetired:Retired`;
    default:
      return state;
  }
}
