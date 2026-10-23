import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleLiveState } from './live.reducer';

export const selectConsoleLiveState = createFeatureSelector<ConsoleLiveState>('consoleLive');

export const selectLiveTargets = createSelector(selectConsoleLiveState, (state) => state.targets);
export const selectLiveReplicas = createSelector(selectLiveTargets, (targets) => targets?.replicas ?? []);
export const selectLiveVolumes = createSelector(selectLiveTargets, (targets) => targets?.volumes ?? []);
export const selectLiveNodes = createSelector(selectLiveTargets, (targets) => targets?.nodes ?? []);
/** Projects with a replica or a volume, sorted. */
export const selectLiveProjects = createSelector(selectLiveTargets, (targets) =>
  [...new Set([...(targets?.replicas ?? []), ...(targets?.volumes ?? [])].map((t) => t.project))].sort(),
);
export const selectLiveTargetsLoading = createSelector(selectConsoleLiveState, (state) => state.targetsLoading);
export const selectLiveTargetsError = createSelector(selectConsoleLiveState, (state) => state.targetsError);
export const selectTerminalSessions = createSelector(selectConsoleLiveState, (state) => state.sessions);
export const selectTerminalSessionsProject = createSelector(selectConsoleLiveState, (state) => state.sessionsProject);
export const selectTerminalSessionsLoading = createSelector(selectConsoleLiveState, (state) => state.sessionsLoading);
export const selectTerminalSessionsError = createSelector(selectConsoleLiveState, (state) => state.sessionsError);
export const selectTunnels = createSelector(selectConsoleLiveState, (state) => state.tunnels);
export const selectTunnelsLoading = createSelector(selectConsoleLiveState, (state) => state.tunnelsLoading);
export const selectTunnelsError = createSelector(selectConsoleLiveState, (state) => state.tunnelsError);
