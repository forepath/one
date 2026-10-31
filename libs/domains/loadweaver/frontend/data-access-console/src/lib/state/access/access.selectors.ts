import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleAccessState } from './access.reducer';

export const selectConsoleAccessState = createFeatureSelector<ConsoleAccessState>('consoleAccess');

export const selectAccessMe = createSelector(selectConsoleAccessState, (state) => state.me);
export const selectAccessLoaded = createSelector(selectConsoleAccessState, (state) => state.me !== null);
export const selectClusterRole = createSelector(selectAccessMe, (me) => me?.clusterRole ?? null);
export const selectIsClusterAdmin = createSelector(selectClusterRole, (role) => role === 'cluster-admin');
/** Cluster roles see infrastructure (nodes, sites, tunnels, addresses); project members only their projects. */
export const selectSeesInfrastructure = createSelector(selectClusterRole, (role) => role !== null);
export const selectProjects = createSelector(selectAccessMe, (me) => Object.keys(me?.projects ?? {}).sort());
/** The last load finished (with the caller's access or an error). */
export const selectAccessSettled = createSelector(
  selectConsoleAccessState,
  (state) => !state.loading && (state.me !== null || state.error !== null),
);
