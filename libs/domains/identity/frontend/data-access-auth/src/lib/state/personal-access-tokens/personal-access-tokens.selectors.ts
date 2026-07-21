import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { PersonalAccessTokensState } from './personal-access-tokens.reducer';

export const selectPersonalAccessTokensState = createFeatureSelector<PersonalAccessTokensState>('personalAccessTokens');

export const selectPersonalAccessTokens = createSelector(selectPersonalAccessTokensState, (state) => state.tokens);

export const selectPersonalAccessTokensLoading = createSelector(
  selectPersonalAccessTokensState,
  (state) => state.loading,
);

export const selectPersonalAccessTokensError = createSelector(selectPersonalAccessTokensState, (state) => state.error);

export const selectPersonalAccessTokensSaving = createSelector(
  selectPersonalAccessTokensState,
  (state) => state.saving,
);

export const selectPersonalAccessTokensRevoking = createSelector(
  selectPersonalAccessTokensState,
  (state) => state.revoking,
);

export const selectPersonalAccessTokenScopes = createSelector(selectPersonalAccessTokensState, (state) => state.scopes);

export const selectPersonalAccessTokenScopesLoading = createSelector(
  selectPersonalAccessTokensState,
  (state) => state.scopesLoading,
);

export const selectPersonalAccessTokenScopesError = createSelector(
  selectPersonalAccessTokensState,
  (state) => state.scopesError,
);

export const selectLastCreatedPersonalAccessTokenPlaintext = createSelector(
  selectPersonalAccessTokensState,
  (state) => state.lastCreatedPlaintext,
);
