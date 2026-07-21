import { createAction, props } from '@ngrx/store';

import type {
  CreatePersonalAccessTokenDto,
  PersonalAccessTokenResponseDto,
  PersonalAccessTokenScopeDto,
  UpdatePersonalAccessTokenDto,
} from '../../types/personal-access-token.types';

export const loadPersonalAccessTokens = createAction('[Personal Access Tokens] Load');

export const loadPersonalAccessTokensSuccess = createAction(
  '[Personal Access Tokens] Load Success',
  props<{ tokens: PersonalAccessTokenResponseDto[] }>(),
);

export const loadPersonalAccessTokensFailure = createAction(
  '[Personal Access Tokens] Load Failure',
  props<{ error: string }>(),
);

export const loadPersonalAccessTokenScopes = createAction('[Personal Access Tokens] Load Scopes');

export const loadPersonalAccessTokenScopesSuccess = createAction(
  '[Personal Access Tokens] Load Scopes Success',
  props<{ scopes: PersonalAccessTokenScopeDto[] }>(),
);

export const loadPersonalAccessTokenScopesFailure = createAction(
  '[Personal Access Tokens] Load Scopes Failure',
  props<{ error: string }>(),
);

export const createPersonalAccessToken = createAction(
  '[Personal Access Tokens] Create',
  props<{ dto: CreatePersonalAccessTokenDto }>(),
);

export const createPersonalAccessTokenSuccess = createAction(
  '[Personal Access Tokens] Create Success',
  props<{ token: PersonalAccessTokenResponseDto }>(),
);

export const createPersonalAccessTokenFailure = createAction(
  '[Personal Access Tokens] Create Failure',
  props<{ error: string }>(),
);

export const updatePersonalAccessToken = createAction(
  '[Personal Access Tokens] Update',
  props<{ id: string; dto: UpdatePersonalAccessTokenDto }>(),
);

export const updatePersonalAccessTokenSuccess = createAction(
  '[Personal Access Tokens] Update Success',
  props<{ token: PersonalAccessTokenResponseDto }>(),
);

export const updatePersonalAccessTokenFailure = createAction(
  '[Personal Access Tokens] Update Failure',
  props<{ error: string }>(),
);

export const revokePersonalAccessToken = createAction('[Personal Access Tokens] Revoke', props<{ id: string }>());

export const revokePersonalAccessTokenSuccess = createAction(
  '[Personal Access Tokens] Revoke Success',
  props<{ id: string }>(),
);

export const revokePersonalAccessTokenFailure = createAction(
  '[Personal Access Tokens] Revoke Failure',
  props<{ error: string }>(),
);

export const clearCreatedPersonalAccessTokenPlaintext = createAction(
  '[Personal Access Tokens] Clear Created Plaintext',
);

export const clearPersonalAccessTokensError = createAction('[Personal Access Tokens] Clear Error');
