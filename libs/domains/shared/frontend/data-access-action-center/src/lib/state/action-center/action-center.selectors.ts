import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ActionCenterGroup } from '../../types/action-center.types';

import { ACTION_CENTER_FEATURE_KEY, type ActionCenterState } from './action-center.reducer';

export const selectActionCenterState = createFeatureSelector<ActionCenterState>(ACTION_CENTER_FEATURE_KEY);

export const selectActionCenterView = createSelector(selectActionCenterState, (state) => state.view);
export const selectActionCenterConnection = createSelector(selectActionCenterState, (state) => state.connection);
export const selectActionCenterLoading = createSelector(selectActionCenterState, (state) => state.loading);
export const selectActionCenterSaving = createSelector(selectActionCenterState, (state) => state.saving);
export const selectActionCenterError = createSelector(selectActionCenterState, (state) => state.error);
export const selectActionCenterPanelOpen = createSelector(selectActionCenterState, (state) => state.panelOpen);

/** The top-bar badge: open to-dos (not silenced), 0 while nothing is loaded. */
export const selectActionCenterOpenCount = createSelector(selectActionCenterView, (view) => view?.counts.open ?? 0);

export const selectActionCenterCanSilenceForEveryone = createSelector(
  selectActionCenterView,
  (view) => view?.canSilenceForEveryone ?? false,
);

export const selectActionCenterSilences = createSelector(selectActionCenterView, (view) => view?.silences ?? []);

/** Groups with something left to do (not silenced as a whole, at least one open record). */
export const selectActionCenterOpenGroups = createSelector(selectActionCenterView, (view): ActionCenterGroup[] =>
  (view?.groups ?? []).filter((group) => group.silencedBy === null && group.openCount > 0),
);

/** Highlighted onboarding / configuration suggestions. */
export const selectActionCenterSetupGroups = createSelector(selectActionCenterOpenGroups, (groups) =>
  groups.filter((group) => group.kind === 'setup'),
);

/** Day-to-day to-dos grouped by category, in the server's order (severity first). */
export const selectActionCenterTaskCategories = createSelector(selectActionCenterOpenGroups, (groups) => {
  const categories = new Map<string, ActionCenterGroup[]>();

  for (const group of groups) {
    if (group.kind !== 'task') {
      continue;
    }

    categories.set(group.category, [...(categories.get(group.category) ?? []), group]);
  }

  return [...categories.entries()].map(([category, entries]) => ({ category, groups: entries }));
});

/** Groups the viewer silenced completely or partially (for the "Silenced" view). */
export const selectActionCenterSilencedGroups = createSelector(selectActionCenterView, (view) =>
  (view?.groups ?? []).filter(
    (group) => group.silencedBy !== null || group.items.some((item) => item.silencedBy !== null),
  ),
);
