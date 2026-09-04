import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { OffersState } from './offers.reducer';

export const selectOffersState = createFeatureSelector<OffersState>('offers');

export const selectOffersSummary = createSelector(selectOffersState, (state) => state.summary);
export const selectOffersSummaryLoading = createSelector(selectOffersState, (state) => state.summaryLoading);
export const selectOffersSummaryError = createSelector(selectOffersState, (state) => state.summaryError);

export const selectPendingOffersList = createSelector(selectOffersState, (state) => state.pendingList);
export const selectPendingOffersListLoading = createSelector(selectOffersState, (state) => state.pendingListLoading);
export const selectPendingOffersListError = createSelector(selectOffersState, (state) => state.pendingListError);

export const selectHistoryOffersList = createSelector(selectOffersState, (state) => state.historyList);
export const selectHistoryOffersListLoading = createSelector(selectOffersState, (state) => state.historyListLoading);
export const selectHistoryOffersListError = createSelector(selectOffersState, (state) => state.historyListError);

export const selectOfferDetailsLoading = createSelector(selectOffersState, (state) => state.detailsLoading);
export const selectRespondingOfferId = createSelector(selectOffersState, (state) => state.respondingOfferId);
export const selectOffersError = createSelector(selectOffersState, (state) => state.error);

export const selectOfferDetailById = (offerId: string) =>
  createSelector(selectOffersState, (state) => state.offerDetails[offerId] ?? null);

export const selectOffersPendingBadgeCount = createSelector(
  selectOffersSummary,
  (summary) => summary?.actionRequiredCount ?? summary?.pendingCount ?? 0,
);
