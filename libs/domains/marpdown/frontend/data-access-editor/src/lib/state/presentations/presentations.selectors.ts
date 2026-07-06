import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { PresentationsState } from './presentations.reducer';

export const selectPresentationsState = createFeatureSelector<PresentationsState>('presentations');

export const selectPresentations = createSelector(selectPresentationsState, (state) => state.entities);

export const selectPresentationsTotal = createSelector(selectPresentationsState, (state) => state.total);

export const selectSelectedPresentation = createSelector(selectPresentationsState, (state) => state.selectedPresentation);

export const selectActivePresentationId = createSelector(selectPresentationsState, (state) => state.activePresentationId);

export const selectActivePresentation = createSelector(
  selectPresentations,
  selectActivePresentationId,
  (presentations, activeId) => (activeId ? (presentations.find((item) => item.id === activeId) ?? null) : null),
);

export const selectPresentationsLoading = createSelector(selectPresentationsState, (state) => state.loading);

export const selectPresentationLoading = createSelector(selectPresentationsState, (state) => state.loadingPresentation);

export const selectPresentationCreating = createSelector(selectPresentationsState, (state) => state.creating);

export const selectPresentationUpdating = createSelector(selectPresentationsState, (state) => state.updating);

export const selectPresentationDeleting = createSelector(selectPresentationsState, (state) => state.deleting);

export const selectPresentationImporting = createSelector(selectPresentationsState, (state) => state.importing);

export const selectPresentationsLoadingAny = createSelector(
  selectPresentationsLoading,
  selectPresentationLoading,
  selectPresentationCreating,
  selectPresentationUpdating,
  selectPresentationDeleting,
  selectPresentationImporting,
  (loading, loadingPresentation, creating, updating, deleting, importing) =>
    loading || loadingPresentation || creating || updating || deleting || importing,
);

export const selectPresentationsError = createSelector(selectPresentationsState, (state) => state.error);

export const selectPresentationById = (id: string) =>
  createSelector(selectPresentations, (presentations) => presentations.find((item) => item.id === id) ?? null);

export const selectHasPresentations = createSelector(selectPresentations, (presentations) => presentations.length > 0);
