import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { DnsZoneStatus } from '../../types/dns.types';
import type { ConsoleDnsState } from './dns.reducer';

export const selectConsoleDnsState = createFeatureSelector<ConsoleDnsState>('consoleDns');

export const selectDnsOverview = createSelector(selectConsoleDnsState, (state) => state.overview);
export const selectDnsLoading = createSelector(selectConsoleDnsState, (state) => state.loading);
export const selectDnsErrors = createSelector(selectConsoleDnsState, (state) => state.errors);
export const selectDnsConfirming = createSelector(selectConsoleDnsState, (state) => state.confirming);
export const selectDnsActionError = createSelector(selectConsoleDnsState, (state) => state.actionError);

/** One zone with its sync state at every provider (primary first) and its declaration. */
export interface DnsZoneRow {
  zone: string;
  primary: string | null;
  dnssec: boolean;
  statuses: DnsZoneStatus[];
  conflicts: number;
  failing: boolean;
}

/** Zones from the declarations and the sync states (a zone may have either). */
export const selectDnsZoneRows = createSelector(selectDnsOverview, (overview): DnsZoneRow[] => {
  const names = new Set<string>([
    ...(overview?.zoneResources ?? []).map((z) => z.metadata.name),
    ...(overview?.zones ?? []).map((z) => z.zone),
  ]);

  return [...names].sort().map((zone) => {
    const resource = overview?.zoneResources?.find((z) => z.metadata.name === zone) ?? null;
    const primary = resource?.spec.provider ?? null;
    const statuses = (overview?.zones ?? [])
      .filter((s) => s.zone === zone)
      .sort(
        (a, b) =>
          Number(b.provider === primary) - Number(a.provider === primary) || a.provider.localeCompare(b.provider),
      );

    return {
      zone,
      primary,
      dnssec: !!resource?.spec.dnssec,
      statuses,
      conflicts: statuses.reduce((sum, s) => sum + s.conflicts.length, 0),
      failing: statuses.some((s) => !!s.error),
    };
  });
});
