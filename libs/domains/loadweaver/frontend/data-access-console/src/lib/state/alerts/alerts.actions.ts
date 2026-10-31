import { createAction, props } from '@ngrx/store';

import type { Alert, AlertListQuery, AlertSilence, CreateAlertSilence } from '../../types/alerts.types';

export const loadAlerts = createAction('[ConsoleAlerts] Load', props<{ query: AlertListQuery; silent?: boolean }>());
export const loadAlertsSuccess = createAction('[ConsoleAlerts] Load Success', props<{ alerts: Alert[] }>());
export const loadAlertsFailure = createAction('[ConsoleAlerts] Load Failure', props<{ error: string }>());

/** One alert by id (`GET /alerts/{id}`), in any state. */
export const loadAlert = createAction('[ConsoleAlerts] Load Alert', props<{ id: string }>());
export const loadAlertSuccess = createAction('[ConsoleAlerts] Load Alert Success', props<{ alert: Alert }>());
export const loadAlertFailure = createAction(
  '[ConsoleAlerts] Load Alert Failure',
  props<{ id: string; error: string }>(),
);

export const acknowledgeAlert = createAction('[ConsoleAlerts] Acknowledge', props<{ id: string }>());
export const acknowledgeAlertSuccess = createAction('[ConsoleAlerts] Acknowledge Success', props<{ alert: Alert }>());
export const acknowledgeAlertFailure = createAction(
  '[ConsoleAlerts] Acknowledge Failure',
  props<{ id: string; error: string }>(),
);

export const loadSilences = createAction('[ConsoleAlerts] Load Silences', props<{ expired: boolean }>());
export const loadSilencesSuccess = createAction(
  '[ConsoleAlerts] Load Silences Success',
  props<{ silences: AlertSilence[] }>(),
);
export const loadSilencesFailure = createAction('[ConsoleAlerts] Load Silences Failure', props<{ error: string }>());

export const createSilence = createAction('[ConsoleAlerts] Create Silence', props<{ silence: CreateAlertSilence }>());
export const createSilenceSuccess = createAction(
  '[ConsoleAlerts] Create Silence Success',
  props<{ silence: AlertSilence }>(),
);
export const createSilenceFailure = createAction('[ConsoleAlerts] Create Silence Failure', props<{ error: string }>());

export const endSilence = createAction('[ConsoleAlerts] End Silence', props<{ id: string }>());
export const endSilenceSuccess = createAction('[ConsoleAlerts] End Silence Success', props<{ id: string }>());
export const endSilenceFailure = createAction(
  '[ConsoleAlerts] End Silence Failure',
  props<{ id: string; error: string }>(),
);

export const clearAlertActionError = createAction('[ConsoleAlerts] Clear Action Error');
