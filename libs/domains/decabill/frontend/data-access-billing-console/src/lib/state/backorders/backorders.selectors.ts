import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { BackordersState } from './backorders.reducer';

export const selectBackordersState = createFeatureSelector<BackordersState>('backorders');

export const selectBackordersEntities = createSelector(selectBackordersState, (state) => state.entities);

export const selectSelectedBackorder = createSelector(selectBackordersState, (state) => state.selectedBackorder);

export const selectBackordersLoading = createSelector(selectBackordersState, (state) => state.loading);

export const selectBackordersRetrying = createSelector(selectBackordersState, (state) => state.retrying);

export const selectBackordersCanceling = createSelector(selectBackordersState, (state) => state.canceling);

export const selectBackordersError = createSelector(selectBackordersState, (state) => state.error);

export const selectBackordersLoadingAny = createSelector(
  selectBackordersLoading,
  selectBackordersRetrying,
  selectBackordersCanceling,
  (loading, retrying, canceling) => loading || retrying || canceling,
);

export const selectBackordersCount = createSelector(selectBackordersEntities, (entities) => entities.length);

export const selectBackorderById = (id: string) =>
  createSelector(selectBackordersEntities, (entities) => entities.find((b) => b.id === id));

export const selectBackordersByStatus = (status: string) =>
  createSelector(selectBackordersEntities, (entities) => entities.filter((b) => b.status === status));

export const selectPendingBackorders = createSelector(selectBackordersEntities, (entities) =>
  entities.filter((b) => b.status === 'pending' || b.status === 'retrying'),
);

export const selectHasBackorders = createSelector(selectBackordersEntities, (entities) => entities.length > 0);
