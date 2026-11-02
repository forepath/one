import { createReducer, on } from '@ngrx/store';

import type { Alert, AlertListQuery, AlertSilence } from '../../types/alerts.types';
import {
  acknowledgeAlert,
  acknowledgeAlertFailure,
  acknowledgeAlertSuccess,
  clearAlertActionError,
  createSilence,
  createSilenceFailure,
  createSilenceSuccess,
  endSilence,
  endSilenceFailure,
  endSilenceSuccess,
  loadAlert,
  loadAlertFailure,
  loadAlerts,
  loadAlertsFailure,
  loadAlertsSuccess,
  loadAlertSuccess,
  loadSilences,
  loadSilencesFailure,
  loadSilencesSuccess,
} from './alerts.actions';

export interface ConsoleAlertsState {
  alerts: Alert[];
  query: AlertListQuery;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  selected: Alert | null;
  selectedLoading: boolean;
  selectedError: string | null;
  /** The alert being acknowledged. */
  acknowledging: string | null;
  silences: AlertSilence[];
  silencesExpired: boolean;
  silencesLoading: boolean;
  silencesError: string | null;
  /** A silence being created. */
  silenceSaving: boolean;
  /** The silence being ended. */
  endingSilence: string | null;
  /** The last failed acknowledge / silence change. */
  actionError: string | null;
}

export const initialConsoleAlertsState: ConsoleAlertsState = {
  alerts: [],
  query: { state: 'open' },
  loading: false,
  error: null,
  selectedId: null,
  selected: null,
  selectedLoading: false,
  selectedError: null,
  acknowledging: null,
  silences: [],
  silencesExpired: false,
  silencesLoading: false,
  silencesError: null,
  silenceSaving: false,
  endingSilence: null,
  actionError: null,
};

function sameQuery(a: AlertListQuery, b: AlertListQuery): boolean {
  return (a.state ?? 'open') === (b.state ?? 'open') && (a.project ?? null) === (b.project ?? null);
}

export const consoleAlertsReducer = createReducer(
  initialConsoleAlertsState,
  on(loadAlerts, (state, { query, silent }) => ({
    ...state,
    alerts: sameQuery(query, state.query) ? state.alerts : [],
    query,
    loading: !silent,
    error: null,
  })),
  on(loadAlertsSuccess, (state, { alerts }) => ({ ...state, alerts, loading: false })),
  on(loadAlertsFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadAlert, (state, { id }) => ({
    ...state,
    selectedId: id,
    selected: state.selected?.id === id ? state.selected : (state.alerts.find((a) => a.id === id) ?? null),
    selectedLoading: true,
    selectedError: null,
  })),
  on(loadAlertSuccess, (state, { alert }) =>
    alert.id === state.selectedId ? { ...state, selected: alert, selectedLoading: false } : state,
  ),
  on(loadAlertFailure, (state, { id, error }) =>
    id === state.selectedId ? { ...state, selectedLoading: false, selectedError: error } : state,
  ),
  on(acknowledgeAlert, (state, { id }) => ({ ...state, acknowledging: id, actionError: null })),
  on(acknowledgeAlertSuccess, (state, { alert }) => ({
    ...state,
    acknowledging: null,
    alerts: state.alerts.map((a) => (a.id === alert.id ? alert : a)),
    selected: state.selected?.id === alert.id ? alert : state.selected,
  })),
  on(acknowledgeAlertFailure, (state, { error }) => ({ ...state, acknowledging: null, actionError: error })),
  on(loadSilences, (state, { expired }) => ({
    ...state,
    silencesExpired: expired,
    silencesLoading: true,
    silencesError: null,
  })),
  on(loadSilencesSuccess, (state, { silences }) => ({ ...state, silences, silencesLoading: false })),
  on(loadSilencesFailure, (state, { error }) => ({ ...state, silencesLoading: false, silencesError: error })),
  on(createSilence, (state) => ({ ...state, silenceSaving: true, actionError: null })),
  on(createSilenceSuccess, (state, { silence }) => ({
    ...state,
    silenceSaving: false,
    silences: [silence, ...state.silences.filter((s) => s.id !== silence.id)],
  })),
  on(createSilenceFailure, (state, { error }) => ({ ...state, silenceSaving: false, actionError: error })),
  on(endSilence, (state, { id }) => ({ ...state, endingSilence: id, actionError: null })),
  on(endSilenceSuccess, (state) => ({ ...state, endingSilence: null })),
  on(endSilenceFailure, (state, { error }) => ({ ...state, endingSilence: null, actionError: error })),
  on(clearAlertActionError, (state) => ({ ...state, actionError: null })),
);
