import { createAction, props } from '@ngrx/store';

import type { AccessMe } from '../../types/console.types';

export const loadAccess = createAction('[ConsoleAccess] Load');
export const loadAccessSuccess = createAction('[ConsoleAccess] Load Success', props<{ me: AccessMe }>());
export const loadAccessFailure = createAction('[ConsoleAccess] Load Failure', props<{ error: string }>());
export const clearAccess = createAction('[ConsoleAccess] Clear');
