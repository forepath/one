import { createAction, props } from '@ngrx/store';

import type { AgentResponseMode, ForwardableEvent, ForwardableEventPayload } from './container-socket.types';

export const connectSocket = createAction('[Container Socket] Connect Socket');

export const connectSocketSuccess = createAction('[Container Socket] Connect Socket Success');

export const connectSocketFailure = createAction(
  '[Container Socket] Connect Socket Failure',
  props<{ error: string }>(),
);

export const socketReconnecting = createAction('[Container Socket] Socket Reconnecting', props<{ attempt: number }>());
export const socketReconnected = createAction('[Container Socket] Socket Reconnected');
export const socketReconnectError = createAction(
  '[Container Socket] Socket Reconnect Error',
  props<{ error: string }>(),
);
export const socketReconnectFailed = createAction(
  '[Container Socket] Socket Reconnect Failed',
  props<{ error: string }>(),
);

export const disconnectSocket = createAction('[Container Socket] Disconnect Socket');

export const disconnectSocketSuccess = createAction('[Container Socket] Disconnect Socket Success');

export const setClient = createAction('[Container Socket] Set Client', props<{ clientId: string }>());

export const setClientSuccess = createAction(
  '[Container Socket] Set Client Success',
  props<{ message: string; clientId: string }>(),
);

export const setClientFailure = createAction('[Container Socket] Set Client Failure', props<{ error: string }>());

export const setChatModel = createAction('[Container Socket] Set Chat Model', props<{ model: string | null }>());

export const setChatResponseMode = createAction(
  '[Container Socket] Set Chat Response Mode',
  props<{ mode: AgentResponseMode }>(),
);

export const forwardEvent = createAction(
  '[Container Socket] Forward Event',
  props<{
    event: ForwardableEvent;
    payload?: ForwardableEventPayload;
    agentId?: string;
  }>(),
);

export const forwardEventSuccess = createAction(
  '[Container Socket] Forward Event Success',
  props<{ received: boolean; event: string }>(),
);

export const forwardEventFailure = createAction('[Container Socket] Forward Event Failure', props<{ error: string }>());

export const socketError = createAction('[Container Socket] Socket Error', props<{ message: string }>());

/** Bus-only: domain slices react; container-socket reducer ignores history. */
export const forwardedEventReceived = createAction(
  '[Container Socket] Forwarded Event Received',
  props<{ event: string; payload: import('./container-socket.types').ForwardedEventPayload }>(),
);

export const remoteDisconnected = createAction('[Container Socket] Remote Disconnected', props<{ clientId: string }>());
export const remoteReconnecting = createAction(
  '[Container Socket] Remote Reconnecting',
  props<{ clientId: string; attempt: number }>(),
);
export const remoteReconnected = createAction('[Container Socket] Remote Reconnected', props<{ clientId: string }>());
export const remoteReconnectError = createAction(
  '[Container Socket] Remote Reconnect Error',
  props<{ clientId: string; error: string }>(),
);
export const remoteReconnectFailed = createAction(
  '[Container Socket] Remote Reconnect Failed',
  props<{ clientId: string; error: string }>(),
);

export const setAgent = createAction('[Container Socket] Set Agent', props<{ agentId: string | null }>());
