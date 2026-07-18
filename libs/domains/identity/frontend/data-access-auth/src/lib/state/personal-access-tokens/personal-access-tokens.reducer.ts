import { createReducer, on } from '@ngrx/store';

import type {
  PersonalAccessTokenResponseDto,
  PersonalAccessTokenScopeDto,
} from '../../types/personal-access-token.types';

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

function sortTokens(tokens: PersonalAccessTokenResponseDto[]): PersonalAccessTokenResponseDto[] {
  return [...tokens].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
}

export interface PersonalAccessTokensState {
  tokens: PersonalAccessTokenResponseDto[];
  loading: boolean;
  saving: boolean;
  revoking: boolean;
  error: string | null;
  scopes: PersonalAccessTokenScopeDto[];
  scopesLoading: boolean;
  scopesError: string | null;
  lastCreatedPlaintext: string | null;
}

export const initialPersonalAccessTokensState: PersonalAccessTokensState = {
  tokens: [],
  loading: false,
  saving: false,
  revoking: false,
  error: null,
  scopes: [],
  scopesLoading: false,
  scopesError: null,
  lastCreatedPlaintext: null,
};

export const personalAccessTokensReducer = createReducer(
  initialPersonalAccessTokensState,
  on(loadPersonalAccessTokens, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(loadPersonalAccessTokensSuccess, (state, { tokens }) => ({
    ...state,
    loading: false,
    tokens: sortTokens(tokens),
    error: null,
  })),
  on(loadPersonalAccessTokensFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(loadPersonalAccessTokenScopes, (state) => ({
    ...state,
    scopesLoading: true,
    scopesError: null,
  })),
  on(loadPersonalAccessTokenScopesSuccess, (state, { scopes }) => ({
    ...state,
    scopesLoading: false,
    scopes,
    scopesError: null,
  })),
  on(loadPersonalAccessTokenScopesFailure, (state, { error }) => ({
    ...state,
    scopesLoading: false,
    scopesError: error,
  })),
  on(createPersonalAccessToken, (state) => ({
    ...state,
    saving: true,
    error: null,
  })),
  on(createPersonalAccessTokenSuccess, (state, { token }) => {
    const { token: plaintext, ...listItem } = token;

    return {
      ...state,
      saving: false,
      tokens: sortTokens([...state.tokens.filter((item) => item.id !== listItem.id), listItem]),
      lastCreatedPlaintext: plaintext ?? null,
      error: null,
    };
  }),
  on(createPersonalAccessTokenFailure, (state, { error }) => ({
    ...state,
    saving: false,
    error,
  })),
  on(updatePersonalAccessToken, (state) => ({
    ...state,
    saving: true,
    error: null,
  })),
  on(updatePersonalAccessTokenSuccess, (state, { token }) => ({
    ...state,
    saving: false,
    tokens: sortTokens([...state.tokens.filter((item) => item.id !== token.id), token]),
    error: null,
  })),
  on(updatePersonalAccessTokenFailure, (state, { error }) => ({
    ...state,
    saving: false,
    error,
  })),
  on(revokePersonalAccessToken, (state) => ({
    ...state,
    revoking: true,
    error: null,
  })),
  on(revokePersonalAccessTokenSuccess, (state, { id }) => ({
    ...state,
    revoking: false,
    tokens: state.tokens.filter((item) => item.id !== id),
    error: null,
  })),
  on(revokePersonalAccessTokenFailure, (state, { error }) => ({
    ...state,
    revoking: false,
    error,
  })),
  on(clearCreatedPersonalAccessTokenPlaintext, (state) => ({
    ...state,
    lastCreatedPlaintext: null,
  })),
  on(clearPersonalAccessTokensError, (state) => ({
    ...state,
    error: null,
  })),
);
