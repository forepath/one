import { createAction, props } from '@ngrx/store';

import type { ActionCenterView, CreateActionCenterSilence } from '../../types/action-center.types';

/** Start the live connection (admins / managers after sign-in). */
export const connectActionCenter = createAction('[Action Center] Connect');
export const disconnectActionCenter = createAction('[Action Center] Disconnect');
export const actionCenterConnected = createAction('[Action Center] Connected');
export const actionCenterReconnecting = createAction('[Action Center] Reconnecting', props<{ attempt: number }>());
export const actionCenterConnectionLost = createAction('[Action Center] Connection Lost', props<{ error: string }>());
export const actionCenterDisconnected = createAction('[Action Center] Disconnected');

/** A fresh view from the socket or a REST response. */
export const actionCenterViewReceived = createAction(
  '[Action Center] View Received',
  props<{ view: ActionCenterView }>(),
);

/** REST load (initial / fallback while the socket is down). */
export const loadActionCenter = createAction('[Action Center] Load');
export const loadActionCenterFailure = createAction('[Action Center] Load Failure', props<{ error: string }>());

export const silenceActionCenterItem = createAction(
  '[Action Center] Silence',
  props<{ silence: CreateActionCenterSilence }>(),
);
export const removeActionCenterSilence = createAction('[Action Center] Remove Silence', props<{ silenceId: string }>());
export const actionCenterSilenceFailure = createAction('[Action Center] Silence Failure', props<{ error: string }>());

export const setActionCenterPanelOpen = createAction('[Action Center] Set Panel Open', props<{ open: boolean }>());
export const toggleActionCenterPanel = createAction('[Action Center] Toggle Panel');
export const clearActionCenterError = createAction('[Action Center] Clear Error');
