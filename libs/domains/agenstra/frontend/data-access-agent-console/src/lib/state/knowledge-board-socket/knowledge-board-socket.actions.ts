import { createAction, props } from '@ngrx/store';

export const connectKnowledgeBoardSocket = createAction('[Knowledge Board Socket] Connect');
export const connectKnowledgeBoardSocketSuccess = createAction('[Knowledge Board Socket] Connect Success');
export const connectKnowledgeBoardSocketFailure = createAction(
  '[Knowledge Board Socket] Connect Failure',
  props<{ error: string }>(),
);

export const disconnectKnowledgeBoardSocket = createAction('[Knowledge Board Socket] Disconnect');
export const disconnectKnowledgeBoardSocketSuccess = createAction('[Knowledge Board Socket] Disconnect Success');

export const knowledgeBoardSocketReconnecting = createAction(
  '[Knowledge Board Socket] Reconnecting',
  props<{ attempt: number }>(),
);
export const knowledgeBoardSocketReconnected = createAction('[Knowledge Board Socket] Reconnected');
export const knowledgeBoardSocketReconnectError = createAction(
  '[Knowledge Board Socket] Reconnect Error',
  props<{ error: string }>(),
);
export const knowledgeBoardSocketReconnectFailed = createAction(
  '[Knowledge Board Socket] Reconnect Failed',
  props<{ error: string }>(),
);

export const setKnowledgeBoardSocketClient = createAction(
  '[Knowledge Board Socket] Set Client',
  props<{ clientId: string }>(),
);
export const setKnowledgeBoardSocketClientSuccess = createAction(
  '[Knowledge Board Socket] Set Client Success',
  props<{ message: string; clientId: string }>(),
);
export const knowledgeBoardSocketError = createAction('[Knowledge Board Socket] Error', props<{ message: string }>());
