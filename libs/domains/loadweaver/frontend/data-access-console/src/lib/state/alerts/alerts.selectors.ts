import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleAlertsState } from './alerts.reducer';

export const selectConsoleAlertsState = createFeatureSelector<ConsoleAlertsState>('consoleAlerts');

export const selectAlerts = createSelector(selectConsoleAlertsState, (state) => state.alerts);
export const selectAlertsQuery = createSelector(selectConsoleAlertsState, (state) => state.query);
export const selectAlertsLoading = createSelector(selectConsoleAlertsState, (state) => state.loading);
export const selectAlertsError = createSelector(selectConsoleAlertsState, (state) => state.error);
export const selectAlertCounts = createSelector(selectAlerts, (alerts) => ({
  firing: alerts.filter((a) => a.state === 'firing').length,
  pending: alerts.filter((a) => a.state === 'pending').length,
  resolved: alerts.filter((a) => a.state === 'resolved').length,
}));
export const selectSelectedAlert = createSelector(selectConsoleAlertsState, (state) => state.selected);
export const selectSelectedAlertLoading = createSelector(selectConsoleAlertsState, (state) => state.selectedLoading);
export const selectSelectedAlertError = createSelector(selectConsoleAlertsState, (state) => state.selectedError);
export const selectAcknowledgingAlert = createSelector(selectConsoleAlertsState, (state) => state.acknowledging);
export const selectSilences = createSelector(selectConsoleAlertsState, (state) => state.silences);
export const selectSilencesExpired = createSelector(selectConsoleAlertsState, (state) => state.silencesExpired);
export const selectSilencesLoading = createSelector(selectConsoleAlertsState, (state) => state.silencesLoading);
export const selectSilencesError = createSelector(selectConsoleAlertsState, (state) => state.silencesError);
export const selectSilenceSaving = createSelector(selectConsoleAlertsState, (state) => state.silenceSaving);
export const selectEndingSilence = createSelector(selectConsoleAlertsState, (state) => state.endingSilence);
export const selectAlertActionError = createSelector(selectConsoleAlertsState, (state) => state.actionError);
