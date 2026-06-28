import { createAction, props } from '@ngrx/store';

export const connectProjectBoardSocket = createAction('[Project Board Socket] Connect');

export const connectProjectBoardSocketSuccess = createAction('[Project Board Socket] Connect Success');

export const connectProjectBoardSocketFailure = createAction(
  '[Project Board Socket] Connect Failure',
  props<{ error: string }>(),
);

export const disconnectProjectBoardSocket = createAction('[Project Board Socket] Disconnect');

export const disconnectProjectBoardSocketSuccess = createAction('[Project Board Socket] Disconnect Success');

export const projectBoardSocketReconnecting = createAction(
  '[Project Board Socket] Reconnecting',
  props<{ attempt: number }>(),
);

export const projectBoardSocketReconnected = createAction('[Project Board Socket] Reconnected');

export const setProjectBoardSocketProject = createAction(
  '[Project Board Socket] Set Project',
  props<{ projectId: string }>(),
);

export const setProjectBoardSocketProjectSuccess = createAction(
  '[Project Board Socket] Set Project Success',
  props<{ message: string; projectId: string }>(),
);

export const projectBoardSocketError = createAction('[Project Board Socket] Error', props<{ message: string }>());
