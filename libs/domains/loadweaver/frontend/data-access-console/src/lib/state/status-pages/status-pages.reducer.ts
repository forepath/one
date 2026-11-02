import { createReducer, on } from '@ngrx/store';

import type { Incident, StatusPageResource } from '../../types/status-pages.types';
import {
  clearIncidentActionError,
  createIncident,
  createIncidentFailure,
  createIncidentSuccess,
  loadIncidents,
  loadIncidentsFailure,
  loadIncidentsSuccess,
  loadStatusPages,
  loadStatusPagesFailure,
  loadStatusPagesSuccess,
  updateIncident,
  updateIncidentFailure,
  updateIncidentSuccess,
} from './status-pages.actions';

export interface ConsoleStatusPagesState {
  pages: StatusPageResource[];
  pagesLoading: boolean;
  pagesError: string | null;
  /** The project whose incidents are shown. */
  project: string | null;
  incidents: Incident[];
  incidentsLoading: boolean;
  incidentsError: string | null;
  /** An incident being created. */
  creating: boolean;
  /** The incident being updated. */
  updating: string | null;
  /** The last failed create / update. */
  actionError: string | null;
}

export const initialConsoleStatusPagesState: ConsoleStatusPagesState = {
  pages: [],
  pagesLoading: false,
  pagesError: null,
  project: null,
  incidents: [],
  incidentsLoading: false,
  incidentsError: null,
  creating: false,
  updating: null,
  actionError: null,
};

function upsert(incidents: Incident[], incident: Incident): Incident[] {
  return incidents.some((i) => i.id === incident.id)
    ? incidents.map((i) => (i.id === incident.id ? incident : i))
    : [incident, ...incidents];
}

export const consoleStatusPagesReducer = createReducer(
  initialConsoleStatusPagesState,
  on(loadStatusPages, (state) => ({ ...state, pagesLoading: true, pagesError: null })),
  on(loadStatusPagesSuccess, (state, { pages }) => ({ ...state, pages, pagesLoading: false })),
  on(loadStatusPagesFailure, (state, { error }) => ({ ...state, pagesLoading: false, pagesError: error })),
  on(loadIncidents, (state, { project, silent }) => ({
    ...state,
    project,
    incidents: project === state.project ? state.incidents : [],
    incidentsLoading: !silent,
    incidentsError: null,
  })),
  on(loadIncidentsSuccess, (state, { project, incidents }) =>
    project === state.project ? { ...state, incidents, incidentsLoading: false } : state,
  ),
  on(loadIncidentsFailure, (state, { project, error }) =>
    project === state.project ? { ...state, incidentsLoading: false, incidentsError: error } : state,
  ),
  on(createIncident, (state) => ({ ...state, creating: true, actionError: null })),
  on(createIncidentSuccess, (state, { incident }) => ({
    ...state,
    creating: false,
    incidents: incident.project === state.project ? upsert(state.incidents, incident) : state.incidents,
  })),
  on(createIncidentFailure, (state, { error }) => ({ ...state, creating: false, actionError: error })),
  on(updateIncident, (state, { id }) => ({ ...state, updating: id, actionError: null })),
  on(updateIncidentSuccess, (state, { incident }) => ({
    ...state,
    updating: null,
    incidents: incident.project === state.project ? upsert(state.incidents, incident) : state.incidents,
  })),
  on(updateIncidentFailure, (state, { error }) => ({ ...state, updating: null, actionError: error })),
  on(clearIncidentActionError, (state) => ({ ...state, actionError: null })),
);
