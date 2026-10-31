import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { GitService } from '../../services/git.service';
import type { GitAccount } from '../../types/git.types';
import {
  cancelPendingGitLink,
  cancelPendingGitLinkDone,
  clearPendingGitLink,
  confirmPendingGitLink,
  confirmPendingGitLinkFailure,
  confirmPendingGitLinkSuccess,
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
  unlinkGitAccountSuccess,
} from './git-accounts.actions';
import {
  cancelPendingGitLink$,
  confirmPendingGitLink$,
  followGitAccountAuthorize$,
  isSafeAuthorizeUrl,
  linkGitAccount$,
  loadGitAccounts$,
  loadPendingGitLink$,
  reloadAfterGitLinkConfirmed$,
} from './git-accounts.effects';
import { consoleGitAccountsReducer, initialConsoleGitAccountsState } from './git-accounts.reducer';

const account: GitAccount = {
  id: 'a1',
  provider: 'github',
  providerUserId: '42',
  login: 'octo',
  createdAt: '2026-10-01T10:00:00.000Z',
};

describe('console git accounts state', () => {
  it('lists, links and unlinks accounts', () => {
    const loaded = consoleGitAccountsReducer(
      consoleGitAccountsReducer(initialConsoleGitAccountsState, loadGitAccounts()),
      loadGitAccountsSuccess({ accounts: [account] }),
    );

    expect(loaded).toMatchObject({ accounts: [account], loading: false });

    const linking = consoleGitAccountsReducer(loaded, linkGitAccount({ provider: 'gitlab' }));

    expect(linking.linking).toBe('gitlab');
    expect(consoleGitAccountsReducer(linking, linkGitAccountFailure({ error: 'x' }))).toMatchObject({
      linking: null,
      changeError: 'x',
    });

    const unlinking = consoleGitAccountsReducer(loaded, unlinkGitAccount({ id: 'a1' }));

    expect(unlinking.unlinking).toBe('a1');
    expect(consoleGitAccountsReducer(unlinking, unlinkGitAccountSuccess({ id: 'a1' })).accounts).toEqual([]);
    expect(
      consoleGitAccountsReducer(
        initialConsoleGitAccountsState,
        loadGitAccountsFailure({ error: 'nf', unavailable: true }),
      ),
    ).toMatchObject({ unavailable: true, error: null });
  });

  it('follows only https authorize URLs', async () => {
    expect(isSafeAuthorizeUrl('https://github.com/login/oauth/authorize?state=x')).toBe(true);
    expect(isSafeAuthorizeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeAuthorizeUrl('http://example.com')).toBe(false);
    expect(isSafeAuthorizeUrl(null)).toBe(false);

    const service = {
      accounts: jest
        .fn()
        .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'Cannot GET' } }))),
      authorizeAccount: jest
        .fn()
        .mockReturnValueOnce(of({ url: 'https://gitlab.com/oauth/authorize?state=s' }))
        .mockReturnValueOnce(of({ url: 'javascript:alert(1)' })),
    };
    const assign = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(loadGitAccounts(), linkGitAccount({ provider: 'gitlab' }), linkGitAccount({ provider: 'github' })),
        ),
        { provide: DOCUMENT, useValue: { defaultView: { location: { assign } } } },
      ],
    });

    const actions = TestBed.inject(Actions);
    const api = service as unknown as GitService;

    expect(await firstValueFrom(loadGitAccounts$(actions, api))).toMatchObject({ unavailable: true });

    const linked = await firstValueFrom(linkGitAccount$(actions, api).pipe(toArray()));

    expect(linked[0]).toEqual(
      linkGitAccountRedirect({ provider: 'gitlab', url: 'https://gitlab.com/oauth/authorize?state=s' }),
    );
    expect(linked[1].type).toBe(linkGitAccountFailure.type);
  });

  it('sends the browser to the provider', async () => {
    const assign = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => of(linkGitAccountRedirect({ provider: 'github', url: 'https://github.com/a' }))),
        { provide: DOCUMENT, useValue: { defaultView: { location: { assign } } } },
      ],
    });

    await firstValueFrom(
      followGitAccountAuthorize$(TestBed.inject(Actions), TestBed.inject(DOCUMENT) as Document).pipe(toArray()),
    );
    expect(assign).toHaveBeenCalledWith('https://github.com/a');
  });

  it('keeps no accounts after the load fails', () => {
    const loaded = consoleGitAccountsReducer(
      initialConsoleGitAccountsState,
      loadGitAccountsSuccess({ accounts: [account] }),
    );

    expect(
      consoleGitAccountsReducer(loaded, loadGitAccountsFailure({ error: 'boom', unavailable: false })),
    ).toMatchObject({ accounts: [], error: 'boom' });
  });

  const pending = {
    provider: 'github' as const,
    login: 'octo',
    providerUserId: '42',
    expiresAt: '2026-10-18T10:10:00Z',
  };

  it('keeps a pending link until it is confirmed, cancelled or fails', () => {
    const loading = consoleGitAccountsReducer(initialConsoleGitAccountsState, loadPendingGitLink({ nonce: 'n1' }));

    expect(loading.pendingState).toBe('loading');

    const ready = consoleGitAccountsReducer(loading, loadPendingGitLinkSuccess({ nonce: 'n1', pending }));

    expect(ready).toMatchObject({ pendingState: 'ready', pending: { ...pending, nonce: 'n1' } });

    const confirming = consoleGitAccountsReducer(ready, confirmPendingGitLink({ nonce: 'n1' }));

    expect(confirming.pendingState).toBe('confirming');

    const confirmed = consoleGitAccountsReducer(confirming, confirmPendingGitLinkSuccess({ account }));

    expect(confirmed).toMatchObject({ pending: null, pendingState: 'idle', confirmed: account, accounts: [account] });

    const conflict = consoleGitAccountsReducer(
      confirming,
      confirmPendingGitLinkFailure({ code: 'already-linked', error: 'linked to another user' }),
    );

    expect(conflict).toMatchObject({
      pending: null,
      pendingError: { code: 'already-linked', message: 'linked to another user' },
    });
    expect(
      consoleGitAccountsReducer(loading, loadPendingGitLinkFailure({ code: 'expired', error: 'Not Found' }))
        .pendingError,
    ).toEqual({ code: 'expired', message: 'Not Found' });

    const cancelling = consoleGitAccountsReducer(ready, cancelPendingGitLink({ nonce: 'n1' }));

    expect(cancelling.pendingState).toBe('cancelling');
    expect(consoleGitAccountsReducer(cancelling, cancelPendingGitLinkDone())).toMatchObject({
      pending: null,
      pendingState: 'idle',
    });
    expect(consoleGitAccountsReducer(confirmed, clearPendingGitLink()).confirmed).toBeNull();
  });

  it('loads, confirms and cancels pending links and tells 404 and 409 apart', async () => {
    const service = {
      pendingAccountLink: jest
        .fn()
        .mockReturnValueOnce(of(pending))
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'Not Found' } }))),
      confirmAccountLink: jest
        .fn()
        .mockReturnValueOnce(of(account))
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'taken' } })))
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'boom' } }))),
      cancelAccountLink: jest
        .fn()
        .mockReturnValueOnce(of(undefined))
        .mockReturnValueOnce(throwError(() => new Error('gone'))),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(
            loadPendingGitLink({ nonce: 'n1' }),
            loadPendingGitLink({ nonce: 'n2' }),
            confirmPendingGitLink({ nonce: 'n1' }),
            confirmPendingGitLink({ nonce: 'n2' }),
            confirmPendingGitLink({ nonce: 'n3' }),
            cancelPendingGitLink({ nonce: 'n1' }),
            cancelPendingGitLink({ nonce: 'n2' }),
            confirmPendingGitLinkSuccess({ account }),
          ),
        ),
      ],
    });

    const actions = TestBed.inject(Actions);
    const api = service as unknown as GitService;
    const loaded = await firstValueFrom(loadPendingGitLink$(actions, api).pipe(toArray()));

    expect(loaded[0]).toEqual(loadPendingGitLinkSuccess({ nonce: 'n1', pending }));
    expect(loaded[1]).toEqual(loadPendingGitLinkFailure({ code: 'expired', error: 'Not Found' }));

    const confirmed = await firstValueFrom(confirmPendingGitLink$(actions, api).pipe(toArray()));

    expect(service.confirmAccountLink).toHaveBeenCalledWith('n1');
    expect(confirmed[0]).toEqual(confirmPendingGitLinkSuccess({ account }));
    expect(confirmed[1]).toEqual(confirmPendingGitLinkFailure({ code: 'already-linked', error: 'taken' }));
    expect(confirmed[2]).toEqual(confirmPendingGitLinkFailure({ code: 'failed', error: 'boom' }));

    const cancelled = await firstValueFrom(cancelPendingGitLink$(actions, api).pipe(toArray()));

    expect(service.cancelAccountLink).toHaveBeenCalledWith('n2');
    expect(cancelled).toEqual([cancelPendingGitLinkDone(), cancelPendingGitLinkDone()]);

    expect(await firstValueFrom(reloadAfterGitLinkConfirmed$(actions))).toEqual(loadGitAccounts());
  });
});
