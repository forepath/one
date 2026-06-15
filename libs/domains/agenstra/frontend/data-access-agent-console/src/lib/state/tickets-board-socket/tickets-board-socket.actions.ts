import { createAction, props } from '@ngrx/store';

export const connectTicketsBoardSocket = createAction('[Tickets Board Socket] Connect');

export const connectTicketsBoardSocketSuccess = createAction('[Tickets Board Socket] Connect Success');

export const connectTicketsBoardSocketFailure = createAction(
  '[Tickets Board Socket] Connect Failure',
  props<{ error: string }>(),
);

export const disconnectTicketsBoardSocket = createAction('[Tickets Board Socket] Disconnect');

export const disconnectTicketsBoardSocketSuccess = createAction('[Tickets Board Socket] Disconnect Success');

export const ticketsBoardSocketReconnecting = createAction(
  '[Tickets Board Socket] Reconnecting',
  props<{ attempt: number }>(),
);

export const ticketsBoardSocketReconnected = createAction('[Tickets Board Socket] Reconnected');

export const ticketsBoardSocketReconnectError = createAction(
  '[Tickets Board Socket] Reconnect Error',
  props<{ error: string }>(),
);

export const ticketsBoardSocketReconnectFailed = createAction(
  '[Tickets Board Socket] Reconnect Failed',
  props<{ error: string }>(),
);

export const setTicketsBoardSocketClient = createAction(
  '[Tickets Board Socket] Set Client',
  props<{ clientId: string }>(),
);

export const setTicketsBoardSocketClientSuccess = createAction(
  '[Tickets Board Socket] Set Client Success',
  props<{ message: string; clientId: string }>(),
);

export const ticketsBoardSocketError = createAction('[Tickets Board Socket] Error', props<{ message: string }>());
