import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../services/auth.service';

import {
  createPersonalAccessToken,
  createPersonalAccessTokenFailure,
  createPersonalAccessTokenSuccess,
  loadPersonalAccessTokenScopes,
  loadPersonalAccessTokenScopesFailure,
  loadPersonalAccessTokenScopesSuccess,
  loadPersonalAccessTokens,
  loadPersonalAccessTokensFailure,
  loadPersonalAccessTokensSuccess,
  revokePersonalAccessToken,
  revokePersonalAccessTokenFailure,
  revokePersonalAccessTokenSuccess,
  updatePersonalAccessToken,
  updatePersonalAccessTokenFailure,
  updatePersonalAccessTokenSuccess,
} from './personal-access-tokens.actions';
import {
  createPersonalAccessToken$,
  loadPersonalAccessTokenScopes$,
  loadPersonalAccessTokens$,
  revokePersonalAccessToken$,
  updatePersonalAccessToken$,
} from './personal-access-tokens.effects';

describe('PersonalAccessTokensEffects', () => {
  let actions$: Actions;
  let authService: {
    listPersonalAccessTokens: jest.Mock;
    listTokenScopes: jest.Mock;
    createPersonalAccessToken: jest.Mock;
    updatePersonalAccessToken: jest.Mock;
    revokePersonalAccessToken: jest.Mock;
  };
  const token = {
    id: 't1',
    name: 'CI',
    tokenPrefix: 'fp_pat_x',
    scopes: ['usage:write'],
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    authService = {
      listPersonalAccessTokens: jest.fn(),
      listTokenScopes: jest.fn(),
      createPersonalAccessToken: jest.fn(),
      updatePersonalAccessToken: jest.fn(),
      revokePersonalAccessToken: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AuthService, useValue: authService }],
    });
  });

  it('loadPersonalAccessTokens$ succeeds', (done) => {
    actions$ = of(loadPersonalAccessTokens());
    authService.listPersonalAccessTokens.mockReturnValue(of([token]));

    TestBed.runInInjectionContext(() => {
      loadPersonalAccessTokens$().subscribe((result) => {
        expect(result).toEqual(loadPersonalAccessTokensSuccess({ tokens: [token] }));
        done();
      });
    });
  });

  it('loadPersonalAccessTokens$ maps HttpErrorResponse message', (done) => {
    actions$ = of(loadPersonalAccessTokens());
    authService.listPersonalAccessTokens.mockReturnValue(
      throwError(() => new HttpErrorResponse({ error: { message: 'Nope' }, status: 403 })),
    );

    TestBed.runInInjectionContext(() => {
      loadPersonalAccessTokens$().subscribe((result) => {
        expect(result).toEqual(loadPersonalAccessTokensFailure({ error: 'Nope' }));
        done();
      });
    });
  });

  it('loadPersonalAccessTokenScopes$ succeeds and fails', (done) => {
    const scopes = [{ scope: 'usage:write' }];

    actions$ = of(loadPersonalAccessTokenScopes());
    authService.listTokenScopes.mockReturnValue(of(scopes));

    TestBed.runInInjectionContext(() => {
      loadPersonalAccessTokenScopes$().subscribe((result) => {
        expect(result).toEqual(loadPersonalAccessTokenScopesSuccess({ scopes }));

        actions$ = of(loadPersonalAccessTokenScopes());
        authService.listTokenScopes.mockReturnValue(throwError(() => new Error('scopes failed')));

        loadPersonalAccessTokenScopes$().subscribe((failure) => {
          expect(failure).toEqual(loadPersonalAccessTokenScopesFailure({ error: 'scopes failed' }));
          done();
        });
      });
    });
  });

  it('createPersonalAccessToken$ succeeds and fails with nested error string', (done) => {
    const created = { ...token, token: 'fp_pat_secret' };

    actions$ = of(createPersonalAccessToken({ dto: { name: 'CI', scopes: ['usage:write'] } }));
    authService.createPersonalAccessToken.mockReturnValue(of(created));

    TestBed.runInInjectionContext(() => {
      createPersonalAccessToken$().subscribe((result) => {
        expect(result).toEqual(createPersonalAccessTokenSuccess({ token: created }));

        actions$ = of(createPersonalAccessToken({ dto: { name: 'CI', scopes: ['usage:write'] } }));
        authService.createPersonalAccessToken.mockReturnValue(
          throwError(() => new HttpErrorResponse({ error: { error: 'denied' }, status: 403 })),
        );

        createPersonalAccessToken$().subscribe((failure) => {
          expect(failure).toEqual(createPersonalAccessTokenFailure({ error: 'denied' }));
          done();
        });
      });
    });
  });

  it('updatePersonalAccessToken$ succeeds and fails', (done) => {
    actions$ = of(updatePersonalAccessToken({ id: 't1', dto: { name: 'CI2', scopes: ['usage:write'] } }));
    authService.updatePersonalAccessToken.mockReturnValue(of({ ...token, name: 'CI2' }));

    TestBed.runInInjectionContext(() => {
      updatePersonalAccessToken$().subscribe((result) => {
        expect(result).toEqual(updatePersonalAccessTokenSuccess({ token: { ...token, name: 'CI2' } }));

        actions$ = of(updatePersonalAccessToken({ id: 't1', dto: { name: 'CI2', scopes: ['usage:write'] } }));
        authService.updatePersonalAccessToken.mockReturnValue(throwError(() => 'update blew up'));

        updatePersonalAccessToken$().subscribe((failure) => {
          expect(failure).toEqual(updatePersonalAccessTokenFailure({ error: 'update blew up' }));
          done();
        });
      });
    });
  });

  it('revokePersonalAccessToken$ succeeds and fails with message object', (done) => {
    actions$ = of(revokePersonalAccessToken({ id: 't1' }));
    authService.revokePersonalAccessToken.mockReturnValue(of(undefined));

    TestBed.runInInjectionContext(() => {
      revokePersonalAccessToken$().subscribe((result) => {
        expect(result).toEqual(revokePersonalAccessTokenSuccess({ id: 't1' }));

        actions$ = of(revokePersonalAccessToken({ id: 't1' }));
        authService.revokePersonalAccessToken.mockReturnValue(throwError(() => ({ message: 'gone' })));

        revokePersonalAccessToken$().subscribe((failure) => {
          expect(failure).toEqual(revokePersonalAccessTokenFailure({ error: 'gone' }));
          done();
        });
      });
    });
  });
});
