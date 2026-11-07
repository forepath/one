import { createAction, props } from '@ngrx/store';

export const connectInitiativesBoardSocket = createAction('[Initiatives Board Socket] Connect');
export const connectInitiativesBoardSocketSuccess = createAction('[Initiatives Board Socket] Connect Success');
export const connectInitiativesBoardSocketFailure = createAction(
  '[Initiatives Board Socket] Connect Failure',
  props<{ error: string }>(),
);

export const disconnectInitiativesBoardSocket = createAction('[Initiatives Board Socket] Disconnect');
export const disconnectInitiativesBoardSocketSuccess = createAction('[Initiatives Board Socket] Disconnect Success');

export const initiativesBoardSocketReconnecting = createAction(
  '[Initiatives Board Socket] Reconnecting',
  props<{ attempt: number }>(),
);
export const initiativesBoardSocketReconnected = createAction('[Initiatives Board Socket] Reconnected');
export const initiativesBoardSocketReconnectError = createAction(
  '[Initiatives Board Socket] Reconnect Error',
  props<{ error: string }>(),
);
export const initiativesBoardSocketReconnectFailed = createAction(
  '[Initiatives Board Socket] Reconnect Failed',
  props<{ error: string }>(),
);

export const setInitiativesBoardSocketClient = createAction(
  '[Initiatives Board Socket] Set Client',
  props<{ clientId: string }>(),
);
export const setInitiativesBoardSocketClientSuccess = createAction(
  '[Initiatives Board Socket] Set Client Success',
  props<{ message: string; clientId: string }>(),
);
export const initiativesBoardSocketError = createAction(
  '[Initiatives Board Socket] Error',
  props<{ message: string }>(),
);
