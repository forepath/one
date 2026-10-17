import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleResourcesState } from './resources.reducer';

export const selectConsoleResourcesState = createFeatureSelector<ConsoleResourcesState>('consoleResources');

export const selectResources = createSelector(selectConsoleResourcesState, (state) => state.resources);
export const selectResourcesLoading = createSelector(selectConsoleResourcesState, (state) => state.loading);
export const selectResourcesError = createSelector(selectConsoleResourcesState, (state) => state.error);
export const selectResourceKinds = createSelector(selectConsoleResourcesState, (state) => state.kinds);
export const selectResourceKindsError = createSelector(selectConsoleResourcesState, (state) => state.kindsError);
export const selectResourceSchemas = createSelector(selectConsoleResourcesState, (state) => state.schemas);
export const selectResourceSchemaErrors = createSelector(selectConsoleResourcesState, (state) => state.schemaErrors);
export const selectSelectedResource = createSelector(selectConsoleResourcesState, (state) => state.selected);
export const selectSelectedResourceLoading = createSelector(
  selectConsoleResourcesState,
  (state) => state.selectedLoading,
);
export const selectSelectedResourceError = createSelector(selectConsoleResourcesState, (state) => state.selectedError);
export const selectResourcePlanning = createSelector(selectConsoleResourcesState, (state) => state.planning);
export const selectResourcePlanError = createSelector(selectConsoleResourcesState, (state) => state.planError);
/** Projects of the listed resources (for the project filter). */
export const selectResourceProjects = createSelector(selectResources, (resources) =>
  [...new Set(resources.flatMap((r) => (r.metadata.project ? [r.metadata.project] : [])))].sort(),
);
/** Listed resources per kind. */
export const selectResourceCounts = createSelector(selectResources, (resources) =>
  resources.reduce<Record<string, number>>((counts, r) => ({ ...counts, [r.kind]: (counts[r.kind] ?? 0) + 1 }), {}),
);
