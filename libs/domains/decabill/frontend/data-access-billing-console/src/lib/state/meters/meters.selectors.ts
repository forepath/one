import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { MetersState } from './meters.reducer';

export const selectMetersState = createFeatureSelector<MetersState>('meters');
export const selectMetersEntities = createSelector(selectMetersState, (state) => state.entities);
export const selectActiveMeters = createSelector(selectMetersEntities, (entities) =>
  entities.filter((meter) => meter.isActive),
);
export const selectSelectedMeter = createSelector(selectMetersState, (state) => state.selectedMeter);
export const selectMetersLoading = createSelector(selectMetersState, (state) => state.loading);
export const selectMeterLoading = createSelector(selectMetersState, (state) => state.loadingMeter);
export const selectMetersCreating = createSelector(selectMetersState, (state) => state.creating);
export const selectMetersUpdating = createSelector(selectMetersState, (state) => state.updating);
export const selectMetersDeleting = createSelector(selectMetersState, (state) => state.deleting);
export const selectMetersError = createSelector(selectMetersState, (state) => state.error);
export const selectMetersLoadingAny = createSelector(
  selectMetersState,
  (state) => state.loading || state.loadingMeter || state.creating || state.updating || state.deleting,
);
export const selectMeterById = (id: string) =>
  createSelector(selectMetersEntities, (entities) => entities.find((meter) => meter.id === id));
