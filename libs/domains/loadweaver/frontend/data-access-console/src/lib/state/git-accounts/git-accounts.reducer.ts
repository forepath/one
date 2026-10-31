import { createReducer, on } from '@ngrx/store';

import type { GitAccount, GitAccountPendingLink, GitAccountProvider } from '../../types/git.types';
import {
  cancelPendingGitLink,
  cancelPendingGitLinkDone,
  clearGitAccountError,
  clearPendingGitLink,
  confirmPendingGitLink,
  confirmPendingGitLinkFailure,
  confirmPendingGitLinkSuccess,
  type GitPendingLinkErrorCode,
  linkGitAccount,
  linkGitAccountFailure,
  loadGitAccounts,
  loadGitAccountsFailure,
  loadGitAccountsSuccess,
  loadPendingGitLink,
  loadPendingGitLinkFailure,
  loadPendingGitLinkSuccess,
  unlinkGitAccount,
  unlinkGitAccountFailure,
  unlinkGitAccountSuccess,
} from './git-accounts.actions';

export interface ConsoleGitAccountsState {
  accounts: GitAccount[];
  loading: boolean;
  error: string | null;
  unavailable: boolean;
  /** The provider being linked; stays set until the browser has left for the provider. */
  linking: GitAccountProvider | null;
  unlinking: string | null;
  changeError: string | null;
  /** The link waiting for confirmation (`?confirm=<nonce>`), with its nonce. */
  pending: (GitAccountPendingLink & { nonce: string }) | null;
  pendingState: 'idle' | 'loading' | 'ready' | 'confirming' | 'cancelling';
  pendingError: { code: GitPendingLinkErrorCode; message: string } | null;
  /** The account just linked by a confirmation. */
  confirmed: GitAccount | null;
}

export const initialConsoleGitAccountsState: ConsoleGitAccountsState = {
  accounts: [],
  loading: false,
  error: null,
  unavailable: false,
  linking: null,
  unlinking: null,
  changeError: null,
  pending: null,
  pendingState: 'idle',
  pendingError: null,
  confirmed: null,
};

export const consoleGitAccountsReducer = createReducer(
  initialConsoleGitAccountsState,
  on(loadGitAccounts, (state) => ({ ...state, loading: true, error: null })),
  on(loadGitAccountsSuccess, (state, { accounts }) => ({ ...state, accounts, loading: false, unavailable: false })),
  on(loadGitAccountsFailure, (state, { error, unavailable }) => ({
    ...state,
    accounts: [],
    loading: false,
    error: unavailable ? null : error,
    unavailable,
  })),
  on(linkGitAccount, (state, { provider }) => ({ ...state, linking: provider, changeError: null })),
  on(linkGitAccountFailure, (state, { error }) => ({ ...state, linking: null, changeError: error })),
  on(unlinkGitAccount, (state, { id }) => ({ ...state, unlinking: id, changeError: null })),
  on(unlinkGitAccountSuccess, (state, { id }) => ({
    ...state,
    unlinking: null,
    accounts: state.accounts.filter((a) => a.id !== id),
  })),
  on(unlinkGitAccountFailure, (state, { error }) => ({ ...state, unlinking: null, changeError: error })),
  on(clearGitAccountError, (state) => ({ ...state, changeError: null })),
  on(loadPendingGitLink, (state) => ({
    ...state,
    pending: null,
    pendingState: 'loading' as const,
    pendingError: null,
    confirmed: null,
  })),
  on(loadPendingGitLinkSuccess, (state, { nonce, pending }) => ({
    ...state,
    pending: { ...pending, nonce },
    pendingState: 'ready' as const,
  })),
  on(loadPendingGitLinkFailure, confirmPendingGitLinkFailure, (state, { code, error }) => ({
    ...state,
    pending: null,
    pendingState: 'idle' as const,
    pendingError: { code, message: error },
  })),
  on(confirmPendingGitLink, (state) => ({ ...state, pendingState: 'confirming' as const, pendingError: null })),
  on(confirmPendingGitLinkSuccess, (state, { account }) => ({
    ...state,
    pending: null,
    pendingState: 'idle' as const,
    confirmed: account,
    accounts: [...state.accounts.filter((a) => a.id !== account.id), account],
  })),
  on(cancelPendingGitLink, (state) => ({ ...state, pendingState: 'cancelling' as const })),
  on(cancelPendingGitLinkDone, clearPendingGitLink, (state) => ({
    ...state,
    pending: null,
    pendingState: 'idle' as const,
    pendingError: null,
    confirmed: null,
  })),
);
