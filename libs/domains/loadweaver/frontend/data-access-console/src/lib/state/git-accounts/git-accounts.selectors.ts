import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleGitAccountsState } from './git-accounts.reducer';

export const selectConsoleGitAccountsState = createFeatureSelector<ConsoleGitAccountsState>('consoleGitAccounts');

export const selectGitAccounts = createSelector(selectConsoleGitAccountsState, (state) => state.accounts);
export const selectGitAccountsLoading = createSelector(selectConsoleGitAccountsState, (state) => state.loading);
export const selectGitAccountsError = createSelector(selectConsoleGitAccountsState, (state) => state.error);
export const selectGitAccountsUnavailable = createSelector(selectConsoleGitAccountsState, (state) => state.unavailable);
export const selectGitAccountLinking = createSelector(selectConsoleGitAccountsState, (state) => state.linking);
export const selectGitAccountUnlinking = createSelector(selectConsoleGitAccountsState, (state) => state.unlinking);
export const selectGitAccountChangeError = createSelector(selectConsoleGitAccountsState, (state) => state.changeError);
export const selectGitPendingLink = createSelector(selectConsoleGitAccountsState, (state) => state.pending);
export const selectGitPendingLinkState = createSelector(selectConsoleGitAccountsState, (state) => state.pendingState);
export const selectGitPendingLinkError = createSelector(selectConsoleGitAccountsState, (state) => state.pendingError);
export const selectGitLinkConfirmed = createSelector(selectConsoleGitAccountsState, (state) => state.confirmed);
