import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, exhaustMap, map, mergeMap, of, switchMap, tap } from 'rxjs';

import { GitService } from '../../services/git.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
  cancelPendingGitLink,
  cancelPendingGitLinkDone,
  confirmPendingGitLink,
  confirmPendingGitLinkFailure,
  confirmPendingGitLinkSuccess,
  type GitPendingLinkErrorCode,
  linkGitAccount,
  linkGitAccountFailure,
  linkGitAccountRedirect,
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

/** Only an `https://` authorize URL is followed (never `javascript:` or another scheme from a response). */
export function isSafeAuthorizeUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;

  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export const loadGitAccounts$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(loadGitAccounts),
      switchMap(() =>
        service.accounts().pipe(
          map((accounts) => loadGitAccountsSuccess({ accounts })),
          catchError((error: unknown) =>
            of(
              loadGitAccountsFailure({
                error: apiErrorMessage(error, 'Failed to load the linked Git accounts'),
                unavailable: error instanceof HttpErrorResponse && error.status === 404,
              }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const linkGitAccount$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(linkGitAccount),
      exhaustMap(({ provider }) =>
        service.authorizeAccount(provider).pipe(
          map(({ url }) =>
            isSafeAuthorizeUrl(url)
              ? linkGitAccountRedirect({ provider, url })
              : linkGitAccountFailure({ error: 'The control plane answered no valid authorize URL' }),
          ),
          catchError((error: unknown) =>
            of(linkGitAccountFailure({ error: apiErrorMessage(error, 'Failed to start linking the account') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** 404: the pending link is unknown, expired or another user's; 409: the provider account is linked to someone else. */
export function pendingLinkErrorCode(error: unknown): GitPendingLinkErrorCode {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 404) return 'expired';

    if (error.status === 409) return 'already-linked';
  }

  return 'failed';
}

/** The browser goes to the provider; it comes back to `/account/git-accounts?confirm=…` or `?error=…`. */
export const followGitAccountAuthorize$ = createEffect(
  (actions$ = inject(Actions), document = inject(DOCUMENT)) =>
    actions$.pipe(
      ofType(linkGitAccountRedirect),
      tap(({ url }) => document.defaultView?.location.assign(url)),
    ),
  { functional: true, dispatch: false },
);

export const unlinkGitAccount$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(unlinkGitAccount),
      mergeMap(({ id }) =>
        service.unlinkAccount(id).pipe(
          map(() => unlinkGitAccountSuccess({ id })),
          catchError((error: unknown) =>
            of(unlinkGitAccountFailure({ id, error: apiErrorMessage(error, 'Failed to unlink the account') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadPendingGitLink$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(loadPendingGitLink),
      switchMap(({ nonce }) =>
        service.pendingAccountLink(nonce).pipe(
          map((pending) => loadPendingGitLinkSuccess({ nonce, pending })),
          catchError((error: unknown) =>
            of(
              loadPendingGitLinkFailure({
                code: pendingLinkErrorCode(error),
                error: apiErrorMessage(error, 'Failed to load the link request'),
              }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const confirmPendingGitLink$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(confirmPendingGitLink),
      exhaustMap(({ nonce }) =>
        service.confirmAccountLink(nonce).pipe(
          map((account) => confirmPendingGitLinkSuccess({ account })),
          catchError((error: unknown) =>
            of(
              confirmPendingGitLinkFailure({
                code: pendingLinkErrorCode(error),
                error: apiErrorMessage(error, 'Failed to link the account'),
              }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** A confirmed link: the list is read again (the server's view of every linked account). */
export const reloadAfterGitLinkConfirmed$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(confirmPendingGitLinkSuccess),
      map(() => loadGitAccounts()),
    ),
  { functional: true },
);

export const cancelPendingGitLink$ = createEffect(
  (actions$ = inject(Actions), service = inject(GitService)) =>
    actions$.pipe(
      ofType(cancelPendingGitLink),
      exhaustMap(({ nonce }) =>
        service.cancelAccountLink(nonce).pipe(
          map(() => cancelPendingGitLinkDone()),
          catchError(() => of(cancelPendingGitLinkDone())),
        ),
      ),
    ),
  { functional: true },
);
