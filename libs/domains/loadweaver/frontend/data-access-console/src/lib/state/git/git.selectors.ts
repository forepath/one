import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleGitState } from './git.reducer';

export const selectConsoleGitState = createFeatureSelector<ConsoleGitState>('consoleGit');

export const selectGitConnections = createSelector(selectConsoleGitState, (state) => state.connections);
export const selectGitConnectionsLoaded = createSelector(selectConsoleGitState, (state) => state.loaded);
export const selectGitConnectionsLoading = createSelector(selectConsoleGitState, (state) => state.loading);
export const selectGitConnectionsError = createSelector(selectConsoleGitState, (state) => state.error);
export const selectGitCommits = createSelector(selectConsoleGitState, (state) => state.commits);
export const selectGitCommitsLoading = createSelector(selectConsoleGitState, (state) => state.commitsLoading);
export const selectGitCommitsError = createSelector(selectConsoleGitState, (state) => state.commitsError);
export const selectGitSaving = createSelector(selectConsoleGitState, (state) => state.saving);
export const selectGitSaveError = createSelector(selectConsoleGitState, (state) => state.saveError);
export const selectGitSaved = createSelector(selectConsoleGitState, (state) => state.saved);
export const selectGitCreated = createSelector(selectConsoleGitState, (state) => state.created);
export const selectGitDeleting = createSelector(selectConsoleGitState, (state) => state.deleting);
export const selectGitDeleteError = createSelector(selectConsoleGitState, (state) => state.deleteError);
export const selectGitActing = createSelector(selectConsoleGitState, (state) => state.acting);
export const selectGitActionError = createSelector(selectConsoleGitState, (state) => state.actionError);
export const selectGitActionResult = createSelector(selectConsoleGitState, (state) => state.actionResult);
export const selectGitWebhookSecret = createSelector(selectConsoleGitState, (state) => state.webhookSecret);
export const selectGitWebhookSecretLoading = createSelector(
  selectConsoleGitState,
  (state) => state.webhookSecretLoading,
);
export const selectGitWebhookSecretRotating = createSelector(
  selectConsoleGitState,
  (state) => state.webhookSecretRotating,
);
export const selectGitWebhookSecretError = createSelector(selectConsoleGitState, (state) => state.webhookSecretError);
export const selectGitSopsRecipient = createSelector(selectConsoleGitState, (state) => state.sopsRecipient);
export const selectGitSopsLoaded = createSelector(selectConsoleGitState, (state) => state.sopsLoaded);
export const selectGitSopsError = createSelector(selectConsoleGitState, (state) => state.sopsError);
export const selectGitSopsUnavailable = createSelector(selectConsoleGitState, (state) => state.sopsUnavailable);
