import { createAction, props } from '@ngrx/store';

// Connect Actions
export const connectSocket = createAction('[Sockets] Connect Socket');

export const connectSocketSuccess = createAction('[Sockets] Connect Socket Success');

export const connectSocketFailure = createAction('[Sockets] Connect Socket Failure', props<{ error: string }>());

// Main Socket Reconnection Actions
export const socketReconnecting = createAction('[Sockets] Socket Reconnecting', props<{ attempt: number }>());
export const socketReconnected = createAction('[Sockets] Socket Reconnected');
export const socketReconnectError = createAction('[Sockets] Socket Reconnect Error', props<{ error: string }>());
export const socketReconnectFailed = createAction('[Sockets] Socket Reconnect Failed', props<{ error: string }>());

// Disconnect Actions
export const disconnectSocket = createAction('[Sockets] Disconnect Socket');

export const disconnectSocketSuccess = createAction('[Sockets] Disconnect Socket Success');

// Set Client Actions
export const setClient = createAction('[Sockets] Set Client', props<{ clientId: string }>());

export const setClientSuccess = createAction(
  '[Sockets] Set Client Success',
  props<{ message: string; clientId: string }>(),
);

export const setClientFailure = createAction('[Sockets] Set Client Failure', props<{ error: string }>());

export const setChatModel = createAction('[Sockets] Set Chat Model', props<{ model: string | null }>());

export const setChatResponseMode = createAction(
  '[Sockets] Set Chat Response Mode',
  props<{ mode: import('./sockets.types').AgentResponseMode }>(),
);

/** User requested prompt enhancement; cleared when result arrives or forward/socket fails. */
export const chatEnhancementStarted = createAction(
  '[Sockets] Chat Enhancement Started',
  props<{ correlationId: string }>(),
);

/** User requested AI ticket body from title; cleared when ticketBodyResult arrives or forward/socket fails. */
export const ticketBodyGenerationStarted = createAction(
  '[Sockets] Ticket Body Generation Started',
  props<{ correlationId: string }>(),
);

// Forward Actions
export const forwardEvent = createAction(
  '[Sockets] Forward Event',
  props<{
    event: import('./sockets.types').ForwardableEvent;
    payload?: import('./sockets.types').ForwardableEventPayload;
    agentId?: string;
  }>(),
);

export const forwardEventSuccess = createAction(
  '[Sockets] Forward Event Success',
  props<{ received: boolean; event: string }>(),
);

export const forwardEventFailure = createAction('[Sockets] Forward Event Failure', props<{ error: string }>());

// Error Actions
export const socketError = createAction('[Sockets] Socket Error', props<{ message: string }>());

// Forwarded Event Actions (events received from remote agents namespace)
export const forwardedEventReceived = createAction(
  '[Sockets] Forwarded Event Received',
  props<{ event: string; payload: import('./sockets.types').ForwardedEventPayload }>(),
);

// Remote Connection Reconnection Actions (per clientId)
export const remoteDisconnected = createAction('[Sockets] Remote Disconnected', props<{ clientId: string }>());
export const remoteReconnecting = createAction(
  '[Sockets] Remote Reconnecting',
  props<{ clientId: string; attempt: number }>(),
);
export const remoteReconnected = createAction('[Sockets] Remote Reconnected', props<{ clientId: string }>());
export const remoteReconnectError = createAction(
  '[Sockets] Remote Reconnect Error',
  props<{ clientId: string; error: string }>(),
);
export const remoteReconnectFailed = createAction(
  '[Sockets] Remote Reconnect Failed',
  props<{ clientId: string; error: string }>(),
);

// Agent Actions
export const setAgent = createAction('[Sockets] Set Agent', props<{ agentId: string | null }>());

// Clear Chat History Actions
export const clearChatHistory = createAction('[Sockets] Clear Chat History');
