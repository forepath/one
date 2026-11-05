import { createAction, props } from '@ngrx/store';

import type {
  IdentityAppGrantResponseDto,
  IdentityAppInputDto,
  IdentityAppResponseDto,
} from '../../types/identity-app.types';

// Apps (admin)
export const loadIdentityApps = createAction('[Identity Apps] Load');
export const loadIdentityAppsSuccess = createAction(
  '[Identity Apps] Load Success',
  props<{ apps: IdentityAppResponseDto[] }>(),
);
export const loadIdentityAppsFailure = createAction('[Identity Apps] Load Failure', props<{ error: string }>());

export const createIdentityApp = createAction('[Identity Apps] Create', props<{ dto: IdentityAppInputDto }>());
export const createIdentityAppSuccess = createAction(
  '[Identity Apps] Create Success',
  props<{ app: IdentityAppResponseDto }>(),
);
export const createIdentityAppFailure = createAction('[Identity Apps] Create Failure', props<{ error: string }>());

export const updateIdentityApp = createAction(
  '[Identity Apps] Update',
  props<{ id: string; dto: IdentityAppInputDto }>(),
);
export const updateIdentityAppSuccess = createAction(
  '[Identity Apps] Update Success',
  props<{ app: IdentityAppResponseDto }>(),
);
export const updateIdentityAppFailure = createAction('[Identity Apps] Update Failure', props<{ error: string }>());

export const rotateIdentityAppSecret = createAction('[Identity Apps] Rotate Secret', props<{ id: string }>());
export const rotateIdentityAppSecretSuccess = createAction(
  '[Identity Apps] Rotate Secret Success',
  props<{ app: IdentityAppResponseDto }>(),
);
export const rotateIdentityAppSecretFailure = createAction(
  '[Identity Apps] Rotate Secret Failure',
  props<{ error: string }>(),
);

export const deleteIdentityApp = createAction('[Identity Apps] Delete', props<{ id: string }>());
export const deleteIdentityAppSuccess = createAction('[Identity Apps] Delete Success', props<{ id: string }>());
export const deleteIdentityAppFailure = createAction('[Identity Apps] Delete Failure', props<{ error: string }>());

export const clearIdentityAppSecret = createAction('[Identity Apps] Clear Secret');
export const clearIdentityAppsError = createAction('[Identity Apps] Clear Error');

// Authorizations of one app (admin)
export const loadIdentityAppGrants = createAction('[Identity Apps] Load Grants', props<{ appId: string }>());
export const loadIdentityAppGrantsSuccess = createAction(
  '[Identity Apps] Load Grants Success',
  props<{ appId: string; grants: IdentityAppGrantResponseDto[] }>(),
);
export const loadIdentityAppGrantsFailure = createAction(
  '[Identity Apps] Load Grants Failure',
  props<{ error: string }>(),
);

export const revokeIdentityAppGrant = createAction(
  '[Identity Apps] Revoke Grant',
  props<{ appId: string; grantId: string }>(),
);
export const revokeIdentityAppGrantSuccess = createAction(
  '[Identity Apps] Revoke Grant Success',
  props<{ appId: string; grantId: string }>(),
);
export const revokeIdentityAppGrantFailure = createAction(
  '[Identity Apps] Revoke Grant Failure',
  props<{ error: string }>(),
);

export const revokeAllIdentityAppGrants = createAction('[Identity Apps] Revoke All Grants', props<{ appId: string }>());
export const revokeAllIdentityAppGrantsSuccess = createAction(
  '[Identity Apps] Revoke All Grants Success',
  props<{ appId: string }>(),
);
export const revokeAllIdentityAppGrantsFailure = createAction(
  '[Identity Apps] Revoke All Grants Failure',
  props<{ error: string }>(),
);

// Own authorized apps (any user)
export const loadOwnAppGrants = createAction('[Identity Apps] Load Own Grants');
export const loadOwnAppGrantsSuccess = createAction(
  '[Identity Apps] Load Own Grants Success',
  props<{ grants: IdentityAppGrantResponseDto[] }>(),
);
export const loadOwnAppGrantsFailure = createAction(
  '[Identity Apps] Load Own Grants Failure',
  props<{ error: string }>(),
);

export const revokeOwnAppGrant = createAction('[Identity Apps] Revoke Own Grant', props<{ grantId: string }>());
export const revokeOwnAppGrantSuccess = createAction(
  '[Identity Apps] Revoke Own Grant Success',
  props<{ grantId: string }>(),
);
export const revokeOwnAppGrantFailure = createAction(
  '[Identity Apps] Revoke Own Grant Failure',
  props<{ error: string }>(),
);
