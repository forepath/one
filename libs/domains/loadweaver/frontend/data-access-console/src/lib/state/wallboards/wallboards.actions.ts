import { createAction, props } from '@ngrx/store';

import type {
  CreatedWallboardToken,
  CreateWallboardTokenRequest,
  KioskView,
  WallboardToken,
} from '../../types/wallboards.types';

export const loadWallboards = createAction('[ConsoleWallboards] Load');
export const loadWallboardsSuccess = createAction(
  '[ConsoleWallboards] Load Success',
  props<{ tokens: WallboardToken[] }>(),
);
export const loadWallboardsFailure = createAction('[ConsoleWallboards] Load Failure', props<{ error: string }>());

export const createWallboard = createAction(
  '[ConsoleWallboards] Create',
  props<{ request: CreateWallboardTokenRequest }>(),
);
export const createWallboardSuccess = createAction(
  '[ConsoleWallboards] Create Success',
  props<{ token: CreatedWallboardToken }>(),
);
export const createWallboardFailure = createAction('[ConsoleWallboards] Create Failure', props<{ error: string }>());
/** Forgets the plaintext token once it was shown. */
export const clearCreatedWallboard = createAction('[ConsoleWallboards] Clear Created');

export const revokeWallboard = createAction('[ConsoleWallboards] Revoke', props<{ id: string }>());
export const revokeWallboardSuccess = createAction('[ConsoleWallboards] Revoke Success', props<{ id: string }>());
export const revokeWallboardFailure = createAction(
  '[ConsoleWallboards] Revoke Failure',
  props<{ id: string; error: string }>(),
);

/** The kiosk (no login): its data for a wallboard token. */
export const loadKiosk = createAction('[ConsoleWallboards] Load Kiosk', props<{ token: string; silent?: boolean }>());
export const loadKioskSuccess = createAction(
  '[ConsoleWallboards] Load Kiosk Success',
  props<{ view: KioskView; at: string }>(),
);
/** `unauthorized`: the token is invalid, expired or revoked (refreshing won't help). */
export const loadKioskFailure = createAction(
  '[ConsoleWallboards] Load Kiosk Failure',
  props<{ error: string; unauthorized: boolean }>(),
);
