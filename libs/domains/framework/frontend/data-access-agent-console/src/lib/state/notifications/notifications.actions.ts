import { createAction, props } from '@ngrx/store';

import type { ActiveEnvironment, StatusPatchPayload, StatusSnapshotPayload } from './notifications.types';

export const connectNotificationsSocket = createAction('[Notifications] Connect Socket');
export const connectNotificationsSocketSuccess = createAction('[Notifications] Connect Socket Success');
export const connectNotificationsSocketFailure = createAction(
  '[Notifications] Connect Socket Failure',
  props<{ error: string }>(),
);
export const disconnectNotificationsSocket = createAction('[Notifications] Disconnect Socket');
export const disconnectNotificationsSocketSuccess = createAction('[Notifications] Disconnect Socket Success');
export const notificationsSocketError = createAction('[Notifications] Socket Error', props<{ message: string }>());
export const notificationsSocketReconnecting = createAction(
  '[Notifications] Socket Reconnecting',
  props<{ attempt: number }>(),
);
export const notificationsSocketReconnected = createAction('[Notifications] Socket Reconnected');
export const notificationsSocketReconnectError = createAction(
  '[Notifications] Socket Reconnect Error',
  props<{ error: string }>(),
);
export const notificationsSocketReconnectFailed = createAction(
  '[Notifications] Socket Reconnect Failed',
  props<{ error: string }>(),
);

export const statusSnapshotReceived = createAction(
  '[Notifications] Status Snapshot Received',
  props<{ snapshot: StatusSnapshotPayload }>(),
);
export const statusPatchReceived = createAction(
  '[Notifications] Status Patch Received',
  props<{ patch: StatusPatchPayload }>(),
);

export const markEnvironmentRead = createAction(
  '[Notifications] Mark Environment Read',
  props<{ clientId: string; agentId: string }>(),
);
export const setActiveEnvironment = createAction(
  '[Notifications] Set Active Environment',
  props<{ clientId: string | null; agentId: string | null }>(),
);
export const setActiveEnvironmentLocal = createAction(
  '[Notifications] Set Active Environment Local',
  props<{ active: ActiveEnvironment | null }>(),
);

export const playUnreadNotificationSound = createAction('[Notifications] Play Unread Sound');
