import type { PersonalAccessTokensState } from './personal-access-tokens.reducer';
import { initialPersonalAccessTokensState } from './personal-access-tokens.reducer';
import {
  selectLastCreatedPersonalAccessTokenPlaintext,
  selectPersonalAccessTokenScopes,
  selectPersonalAccessTokenScopesError,
  selectPersonalAccessTokenScopesLoading,
  selectPersonalAccessTokens,
  selectPersonalAccessTokensError,
  selectPersonalAccessTokensLoading,
  selectPersonalAccessTokensRevoking,
  selectPersonalAccessTokensSaving,
} from './personal-access-tokens.selectors';

describe('personalAccessTokens selectors', () => {
  const state: PersonalAccessTokensState = {
    ...initialPersonalAccessTokensState,
    tokens: [
      {
        id: 't1',
        name: 'CI',
        tokenPrefix: 'fp_pat_x',
        scopes: ['usage:write'],
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    loading: true,
    error: 'boom',
    saving: true,
    revoking: true,
    scopes: [{ scope: 'usage:write' }],
    scopesLoading: true,
    scopesError: 'scopes boom',
    lastCreatedPlaintext: 'fp_pat_secret',
  };
  const project = <T>(selector: (root: { personalAccessTokens: PersonalAccessTokensState }) => T): T =>
    selector({ personalAccessTokens: state });

  it('selects list and mutation flags', () => {
    expect(project(selectPersonalAccessTokens)).toEqual(state.tokens);
    expect(project(selectPersonalAccessTokensLoading)).toBe(true);
    expect(project(selectPersonalAccessTokensError)).toBe('boom');
    expect(project(selectPersonalAccessTokensSaving)).toBe(true);
    expect(project(selectPersonalAccessTokensRevoking)).toBe(true);
  });

  it('selects scopes and created plaintext', () => {
    expect(project(selectPersonalAccessTokenScopes)).toEqual(state.scopes);
    expect(project(selectPersonalAccessTokenScopesLoading)).toBe(true);
    expect(project(selectPersonalAccessTokenScopesError)).toBe('scopes boom');
    expect(project(selectLastCreatedPersonalAccessTokenPlaintext)).toBe('fp_pat_secret');
  });
});
