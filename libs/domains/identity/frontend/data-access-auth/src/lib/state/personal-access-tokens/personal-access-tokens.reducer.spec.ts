import {
  clearCreatedPersonalAccessTokenPlaintext,
  clearPersonalAccessTokensError,
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
import { initialPersonalAccessTokensState, personalAccessTokensReducer } from './personal-access-tokens.reducer';

describe('personalAccessTokensReducer', () => {
  it('sets loading and clears error on load', () => {
    const state = personalAccessTokensReducer(
      { ...initialPersonalAccessTokensState, error: 'old' },
      loadPersonalAccessTokens(),
    );

    expect(state.loading).toBe(true);
    expect(state.error).toBeNull();
  });

  it('stores load failure', () => {
    const state = personalAccessTokensReducer(
      { ...initialPersonalAccessTokensState, loading: true },
      loadPersonalAccessTokensFailure({ error: 'load failed' }),
    );

    expect(state.loading).toBe(false);
    expect(state.error).toBe('load failed');
  });

  it('loads and fails scopes', () => {
    const loading = personalAccessTokensReducer(initialPersonalAccessTokensState, loadPersonalAccessTokenScopes());
    const success = personalAccessTokensReducer(
      loading,
      loadPersonalAccessTokenScopesSuccess({ scopes: [{ scope: 'usage:write' }] }),
    );
    const failure = personalAccessTokensReducer(
      loading,
      loadPersonalAccessTokenScopesFailure({ error: 'scopes failed' }),
    );

    expect(loading.scopesLoading).toBe(true);
    expect(success.scopes).toEqual([{ scope: 'usage:write' }]);
    expect(success.scopesLoading).toBe(false);
    expect(failure.scopesError).toBe('scopes failed');
  });

  it('tracks create/update/revoke pending and failure flags', () => {
    expect(
      personalAccessTokensReducer(
        initialPersonalAccessTokensState,
        createPersonalAccessToken({ dto: { name: 'CI', scopes: [] } }),
      ).saving,
    ).toBe(true);
    expect(
      personalAccessTokensReducer(
        { ...initialPersonalAccessTokensState, saving: true },
        createPersonalAccessTokenFailure({ error: 'create failed' }),
      ).error,
    ).toBe('create failed');
    expect(
      personalAccessTokensReducer(
        initialPersonalAccessTokensState,
        updatePersonalAccessToken({ id: '1', dto: { name: 'CI', scopes: [] } }),
      ).saving,
    ).toBe(true);
    expect(
      personalAccessTokensReducer(
        { ...initialPersonalAccessTokensState, saving: true },
        updatePersonalAccessTokenFailure({ error: 'update failed' }),
      ).error,
    ).toBe('update failed');
    expect(
      personalAccessTokensReducer(initialPersonalAccessTokensState, revokePersonalAccessToken({ id: '1' })).revoking,
    ).toBe(true);
    expect(
      personalAccessTokensReducer(
        { ...initialPersonalAccessTokensState, revoking: true },
        revokePersonalAccessTokenFailure({ error: 'revoke failed' }),
      ).error,
    ).toBe('revoke failed');
  });

  it('clears error', () => {
    const state = personalAccessTokensReducer(
      { ...initialPersonalAccessTokensState, error: 'old' },
      clearPersonalAccessTokensError(),
    );

    expect(state.error).toBeNull();
  });

  it('should store loaded tokens sorted by createdAt desc', () => {
    const state = personalAccessTokensReducer(
      initialPersonalAccessTokensState,
      loadPersonalAccessTokensSuccess({
        tokens: [
          {
            id: '1',
            name: 'Older',
            tokenPrefix: 'fp_pat_a',
            scopes: ['read'],
            expiresAt: null,
            revokedAt: null,
            lastUsedAt: null,
            createdAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: '2',
            name: 'Newer',
            tokenPrefix: 'fp_pat_b',
            scopes: ['write'],
            expiresAt: null,
            revokedAt: null,
            lastUsedAt: null,
            createdAt: '2024-02-01T00:00:00.000Z',
          },
        ],
      }),
    );

    expect(state.tokens.map((token) => token.id)).toEqual(['2', '1']);
    expect(state.loading).toBe(false);
  });

  it('should keep plaintext only in lastCreatedPlaintext on create success', () => {
    const state = personalAccessTokensReducer(
      initialPersonalAccessTokensState,
      createPersonalAccessTokenSuccess({
        token: {
          id: '1',
          name: 'CI',
          tokenPrefix: 'fp_pat_x',
          scopes: ['read'],
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: '2024-02-01T00:00:00.000Z',
          token: 'fp_pat_secret',
        },
      }),
    );

    expect(state.lastCreatedPlaintext).toBe('fp_pat_secret');
    expect(state.tokens[0]?.token).toBeUndefined();
    expect(state.saving).toBe(false);
  });

  it('should upsert updated tokens without plaintext', () => {
    const withToken = personalAccessTokensReducer(
      initialPersonalAccessTokensState,
      createPersonalAccessTokenSuccess({
        token: {
          id: '1',
          name: 'CI',
          tokenPrefix: 'fp_pat_x',
          scopes: ['read'],
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: '2024-02-01T00:00:00.000Z',
          token: 'fp_pat_secret',
        },
      }),
    );
    const updated = personalAccessTokensReducer(
      withToken,
      updatePersonalAccessTokenSuccess({
        token: {
          id: '1',
          name: 'CI-renamed',
          tokenPrefix: 'fp_pat_x',
          scopes: ['write'],
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: '2024-02-01T00:00:00.000Z',
        },
      }),
    );

    expect(updated.tokens).toEqual([
      {
        id: '1',
        name: 'CI-renamed',
        tokenPrefix: 'fp_pat_x',
        scopes: ['write'],
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: '2024-02-01T00:00:00.000Z',
      },
    ]);
    expect(updated.saving).toBe(false);
    expect(updated.lastCreatedPlaintext).toBe('fp_pat_secret');
  });

  it('should remove revoked tokens and clear plaintext', () => {
    const withToken = personalAccessTokensReducer(
      initialPersonalAccessTokensState,
      createPersonalAccessTokenSuccess({
        token: {
          id: '1',
          name: 'CI',
          tokenPrefix: 'fp_pat_x',
          scopes: ['read'],
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: '2024-02-01T00:00:00.000Z',
          token: 'fp_pat_secret',
        },
      }),
    );
    const revoked = personalAccessTokensReducer(withToken, revokePersonalAccessTokenSuccess({ id: '1' }));
    const cleared = personalAccessTokensReducer(revoked, clearCreatedPersonalAccessTokenPlaintext());

    expect(revoked.tokens).toEqual([]);
    expect(cleared.lastCreatedPlaintext).toBeNull();
  });
});
