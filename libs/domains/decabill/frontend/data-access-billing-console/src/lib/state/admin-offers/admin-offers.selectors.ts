import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AdminOffersState } from './admin-offers.reducer';

export const selectAdminOffersState = createFeatureSelector<AdminOffersState>('adminOffers');

export const selectAdminOffers = createSelector(selectAdminOffersState, (state) => state.offers);
export const selectAdminOffersLoading = createSelector(selectAdminOffersState, (state) => state.loading);
export const selectAdminOffersCreating = createSelector(selectAdminOffersState, (state) => state.creating);
export const selectAdminOffersUpdating = createSelector(selectAdminOffersState, (state) => state.updating);
export const selectAdminOffersDeleting = createSelector(selectAdminOffersState, (state) => state.deleting);
export const selectAdminOffersArchiving = createSelector(selectAdminOffersState, (state) => state.archiving);
export const selectAdminOffersRevoking = createSelector(selectAdminOffersState, (state) => state.revoking);
export const selectAdminOffersError = createSelector(selectAdminOffersState, (state) => state.error);

export const selectAdminOfferStatistics = createSelector(selectAdminOffersState, (state) => state.statistics);
export const selectAdminOfferStatisticsLoading = createSelector(
  selectAdminOffersState,
  (state) => state.statisticsLoading,
);
export const selectAdminOfferStatisticsError = createSelector(selectAdminOffersState, (state) => state.statisticsError);

export const selectAdminOfferAuditLogsByOffer = createSelector(
  selectAdminOffersState,
  (state) => state.auditLogsByOffer,
);
export const selectAdminOfferAuditLogsTotalByOffer = createSelector(
  selectAdminOffersState,
  (state) => state.auditLogsTotalByOffer,
);
export const selectAdminOfferAuditLogsOffsetByOffer = createSelector(
  selectAdminOffersState,
  (state) => state.auditLogsOffsetByOffer,
);
export const selectAdminOfferAuditLogsLoading = createSelector(
  selectAdminOffersState,
  (state) => state.auditLogsLoading,
);
export const selectAdminOfferAuditLogsAppendLoading = createSelector(
  selectAdminOffersState,
  (state) => state.auditLogsAppendLoading,
);
export const selectAdminOfferAuditLogsError = createSelector(selectAdminOffersState, (state) => state.auditLogsError);

export const selectAdminOfferAuditLogsForOffer = (offerId: string) =>
  createSelector(selectAdminOfferAuditLogsByOffer, (byOffer) => byOffer[offerId] ?? []);

export const selectAdminOfferAuditLogsHasMore = (offerId: string) =>
  createSelector(selectAdminOfferAuditLogsTotalByOffer, selectAdminOfferAuditLogsOffsetByOffer, (totals, offsets) => {
    const total = totals[offerId] ?? 0;
    const offset = offsets[offerId] ?? 0;

    return offset < total;
  });

export const selectAdminOffersMutating = createSelector(
  selectAdminOffersCreating,
  selectAdminOffersUpdating,
  selectAdminOffersDeleting,
  selectAdminOffersArchiving,
  selectAdminOffersRevoking,
  (creating, updating, deleting, archiving, revoking) => creating || updating || deleting || archiving || revoking,
);
