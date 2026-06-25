import { createFeatureSelector, createSelector } from '@ngrx/store';

import type {
  AdminDatevExportListEntry,
  AdminDatevExportListItem,
  AdminDatevExportQueuedListItem,
  DatevExportScope,
} from '../../types/billing.types';

import type { AdminDatevExportsState } from './admin-datev-exports.reducer';

export const selectAdminDatevExportsState = createFeatureSelector<AdminDatevExportsState>('adminDatevExports');

export const selectAdminDatevExportItems = createSelector(selectAdminDatevExportsState, (state) => state.items);

export const selectAdminDatevExportDisplayItems = createSelector(selectAdminDatevExportsState, (state) => {
  const placeholders: AdminDatevExportQueuedListItem[] = state.queuedExports
    .filter((queued) => !state.items.some((item) => matchesQueuedExport(item, queued)))
    .map((queued) => ({
      kind: 'queued' as const,
      id: `queued-${queued.clientId}`,
      scope: queued.scope,
      periodYear: queued.periodYear,
      periodMonth: queued.periodMonth,
    }));

  const entries: AdminDatevExportListEntry[] = [...placeholders, ...state.items];

  return entries;
});

function matchesQueuedExport(
  item: AdminDatevExportListItem,
  queued: { scope: DatevExportScope; periodYear: number; periodMonth: number },
): boolean {
  return (
    item.scope === queued.scope && item.periodYear === queued.periodYear && item.periodMonth === queued.periodMonth
  );
}

export const selectAdminDatevExportsLoading = createSelector(selectAdminDatevExportsState, (state) => state.loading);

export const selectAdminDatevExportsError = createSelector(selectAdminDatevExportsState, (state) => state.error);

export const selectAdminDatevExportsScope = createSelector(selectAdminDatevExportsState, (state) => state.scope);

export const selectAdminDatevExportsTriggerLoading = createSelector(
  selectAdminDatevExportsState,
  (state) => state.triggerLoading,
);

export const selectAdminDatevExportsTriggerError = createSelector(
  selectAdminDatevExportsState,
  (state) => state.triggerError,
);
