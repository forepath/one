import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { InventoryState } from './inventory.reducer';

export const selectInventoryState = createFeatureSelector<InventoryState>('inventory');

export const selectInventoryWarehouses = createSelector(selectInventoryState, (state) => state.warehouses);
export const selectInventoryCompartments = createSelector(selectInventoryState, (state) => state.compartments);
export const selectInventoryCompartmentStock = createSelector(selectInventoryState, (state) => state.compartmentStock);
export const selectInventoryArticles = createSelector(selectInventoryState, (state) => state.articles);
export const selectInventoryArticleStock = createSelector(selectInventoryState, (state) => state.articleStock);
export const selectInventoryRequests = createSelector(selectInventoryState, (state) => state.requests);
export const selectInventoryMovements = createSelector(selectInventoryState, (state) => state.movements);
export const selectInventoryArticleFilters = createSelector(selectInventoryState, (state) => state.articleFilters);
export const selectInventoryRequestStatus = createSelector(selectInventoryState, (state) => state.requestStatus);
export const selectInventoryMovementFilters = createSelector(selectInventoryState, (state) => state.movementFilters);
export const selectInventorySummary = createSelector(selectInventoryState, (state) => state.summary);
export const selectInventorySelectedArticle = createSelector(selectInventoryState, (state) => state.selectedArticle);
export const selectInventoryMutating = createSelector(selectInventoryState, (state) => state.mutating);
export const selectInventoryMutationError = createSelector(selectInventoryState, (state) => state.mutationError);
export const selectInventorySocketConnected = createSelector(selectInventoryState, (state) => state.socketConnected);
export const selectInventoryLendings = createSelector(selectInventoryState, (state) => state.lendings);
export const selectInventoryLendingFilters = createSelector(selectInventoryState, (state) => state.lendingFilters);
export const selectInventorySerialUnits = createSelector(selectInventoryState, (state) => state.serialUnits);
