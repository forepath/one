import { createAction, props } from '@ngrx/store';

import type { CreateIncident, Incident, StatusPageResource, UpdateIncident } from '../../types/status-pages.types';

export const loadStatusPages = createAction('[ConsoleStatusPages] Load Pages');
export const loadStatusPagesSuccess = createAction(
  '[ConsoleStatusPages] Load Pages Success',
  props<{ pages: StatusPageResource[] }>(),
);
export const loadStatusPagesFailure = createAction(
  '[ConsoleStatusPages] Load Pages Failure',
  props<{ error: string }>(),
);

export const loadIncidents = createAction(
  '[ConsoleStatusPages] Load Incidents',
  props<{ project: string; silent?: boolean }>(),
);
export const loadIncidentsSuccess = createAction(
  '[ConsoleStatusPages] Load Incidents Success',
  props<{ project: string; incidents: Incident[] }>(),
);
export const loadIncidentsFailure = createAction(
  '[ConsoleStatusPages] Load Incidents Failure',
  props<{ project: string; error: string }>(),
);

export const createIncident = createAction(
  '[ConsoleStatusPages] Create Incident',
  props<{ project: string; incident: CreateIncident }>(),
);
export const createIncidentSuccess = createAction(
  '[ConsoleStatusPages] Create Incident Success',
  props<{ incident: Incident }>(),
);
export const createIncidentFailure = createAction(
  '[ConsoleStatusPages] Create Incident Failure',
  props<{ error: string }>(),
);

export const updateIncident = createAction(
  '[ConsoleStatusPages] Update Incident',
  props<{ project: string; id: string; update: UpdateIncident }>(),
);
export const updateIncidentSuccess = createAction(
  '[ConsoleStatusPages] Update Incident Success',
  props<{ incident: Incident }>(),
);
export const updateIncidentFailure = createAction(
  '[ConsoleStatusPages] Update Incident Failure',
  props<{ id: string; error: string }>(),
);

export const clearIncidentActionError = createAction('[ConsoleStatusPages] Clear Action Error');
