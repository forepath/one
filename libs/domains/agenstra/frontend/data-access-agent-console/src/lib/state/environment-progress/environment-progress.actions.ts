import { createAction, props } from '@ngrx/store';

import type { EnvironmentProgress } from './environment-progress.types';

/** Load the current provisioning operations of a workspace via REST (initial state before socket events). */
export const loadEnvironmentProgress = createAction(
  '[Environment Progress] Load Environment Progress',
  props<{ clientId: string }>(),
);

export const loadEnvironmentProgressSuccess = createAction(
  '[Environment Progress] Load Environment Progress Success',
  props<{ clientId: string; operations: EnvironmentProgress[] }>(),
);

export const loadEnvironmentProgressFailure = createAction(
  '[Environment Progress] Load Environment Progress Failure',
  props<{ clientId: string; error: string }>(),
);

/** Live progress event of the selected workspace (forwarded `environmentProgress` socket event). */
export const environmentProgressReceived = createAction(
  '[Environment Progress] Environment Progress Received',
  props<{ clientId: string; progress: EnvironmentProgress }>(),
);
