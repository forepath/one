import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { InitiativesState } from './initiatives.reducer';

export const selectInitiativesState = createFeatureSelector<InitiativesState>('initiatives');
export const selectInitiativesList = createSelector(selectInitiativesState, (s) => s.list);
export const selectInitiativesTotal = createSelector(selectInitiativesState, (s) => s.total);
export const selectInitiativesListLoading = createSelector(selectInitiativesState, (s) => s.listLoading);
export const selectSelectedInitiativeId = createSelector(selectInitiativesState, (s) => s.selectedId);
export const selectSelectedInitiative = createSelector(
  selectInitiativesState,
  (s) => s.overview?.initiative ?? s.list.find((row) => row.id === s.selectedId) ?? null,
);
export const selectInitiativeDetailLoading = createSelector(selectInitiativesState, (s) => s.detailLoading);
export const selectInitiativeOverview = createSelector(selectInitiativesState, (s) => s.overview);
export const selectInitiativeArtifacts = createSelector(selectInitiativesState, (s) => s.artifacts);
export const selectOpenInitiativeArtifact = createSelector(selectInitiativesState, (s) => s.openArtifact);
export const selectOpenInitiativeArtifactId = createSelector(selectInitiativesState, (s) => s.openArtifactId);
export const selectInitiativeArtifactVersions = createSelector(selectInitiativesState, (s) => s.versions);
export const selectInitiativeCompareVersion = createSelector(selectInitiativesState, (s) => s.compareVersion);
export const selectInitiativeWorkItems = createSelector(selectInitiativesState, (s) => s.workItems);
export const selectInitiativeRuns = createSelector(selectInitiativesState, (s) => s.runs);
export const selectOpenInitiativeRun = createSelector(selectInitiativesState, (s) => s.openRun);
export const selectInitiativeProposals = createSelector(selectInitiativesState, (s) => s.proposals);
export const selectInitiativeFindings = createSelector(selectInitiativesState, (s) => s.findings);
export const selectInitiativeDecisions = createSelector(selectInitiativesState, (s) => s.decisions);
export const selectInitiativeActivity = createSelector(selectInitiativesState, (s) => s.activity);
export const selectInitiativesPending = createSelector(selectInitiativesState, (s) => s.pending > 0);
export const selectInitiativesError = createSelector(selectInitiativesState, (s) => s.error);
export const selectInitiativesConflict = createSelector(selectInitiativesState, (s) => s.conflict);
export const selectCreatedInitiativeId = createSelector(selectInitiativesState, (s) => s.createdId);
export const selectInitiativeLastBuildResult = createSelector(selectInitiativesState, (s) => s.lastBuildResult);
