import { createAction, props } from '@ngrx/store';

import type { GitAccount, GitAccountPendingLink, GitAccountProvider } from '../../types/git.types';

/** Why a pending link can't be confirmed: `expired` (404), `already-linked` (409, another user's) or anything else. */
export type GitPendingLinkErrorCode = 'expired' | 'already-linked' | 'failed';

export const loadGitAccounts = createAction('[ConsoleGitAccounts] Load');
export const loadGitAccountsSuccess = createAction(
  '[ConsoleGitAccounts] Load Success',
  props<{ accounts: GitAccount[] }>(),
);
/** `unavailable`: account linking isn't offered by this control plane (yet). */
export const loadGitAccountsFailure = createAction(
  '[ConsoleGitAccounts] Load Failure',
  props<{ error: string; unavailable: boolean }>(),
);

/** Starts the OAuth link: the browser leaves for the provider's authorize URL. */
export const linkGitAccount = createAction('[ConsoleGitAccounts] Link', props<{ provider: GitAccountProvider }>());
export const linkGitAccountRedirect = createAction(
  '[ConsoleGitAccounts] Link Redirect',
  props<{ provider: GitAccountProvider; url: string }>(),
);
export const linkGitAccountFailure = createAction('[ConsoleGitAccounts] Link Failure', props<{ error: string }>());

export const unlinkGitAccount = createAction('[ConsoleGitAccounts] Unlink', props<{ id: string }>());
export const unlinkGitAccountSuccess = createAction('[ConsoleGitAccounts] Unlink Success', props<{ id: string }>());
export const unlinkGitAccountFailure = createAction(
  '[ConsoleGitAccounts] Unlink Failure',
  props<{ id: string; error: string }>(),
);
export const clearGitAccountError = createAction('[ConsoleGitAccounts] Clear Error');

/** The OAuth callback came back with `?confirm=<nonce>`: the account waits for the user's confirmation. */
export const loadPendingGitLink = createAction('[ConsoleGitAccounts] Load Pending Link', props<{ nonce: string }>());
export const loadPendingGitLinkSuccess = createAction(
  '[ConsoleGitAccounts] Load Pending Link Success',
  props<{ nonce: string; pending: GitAccountPendingLink }>(),
);
export const loadPendingGitLinkFailure = createAction(
  '[ConsoleGitAccounts] Load Pending Link Failure',
  props<{ code: GitPendingLinkErrorCode; error: string }>(),
);
export const confirmPendingGitLink = createAction(
  '[ConsoleGitAccounts] Confirm Pending Link',
  props<{ nonce: string }>(),
);
export const confirmPendingGitLinkSuccess = createAction(
  '[ConsoleGitAccounts] Confirm Pending Link Success',
  props<{ account: GitAccount }>(),
);
export const confirmPendingGitLinkFailure = createAction(
  '[ConsoleGitAccounts] Confirm Pending Link Failure',
  props<{ code: GitPendingLinkErrorCode; error: string }>(),
);
/** Drops the pending link at the control plane (a failure is ignored: it expires on its own). */
export const cancelPendingGitLink = createAction(
  '[ConsoleGitAccounts] Cancel Pending Link',
  props<{ nonce: string }>(),
);
export const cancelPendingGitLinkDone = createAction('[ConsoleGitAccounts] Cancel Pending Link Done');
/** Forgets the confirmation and its result. */
export const clearPendingGitLink = createAction('[ConsoleGitAccounts] Clear Pending Link');
