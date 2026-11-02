import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, concatMap, map, of, switchMap } from 'rxjs';

import { StatusPagesService } from '../../services/status-pages.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
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

export const loadStatusPages$ = createEffect(
  (actions$ = inject(Actions), service = inject(StatusPagesService)) =>
    actions$.pipe(
      ofType(loadStatusPages),
      switchMap(() =>
        service.pages().pipe(
          map((pages) => loadStatusPagesSuccess({ pages })),
          catchError((error: unknown) =>
            of(loadStatusPagesFailure({ error: apiErrorMessage(error, 'Failed to load status pages') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadIncidents$ = createEffect(
  (actions$ = inject(Actions), service = inject(StatusPagesService)) =>
    actions$.pipe(
      ofType(loadIncidents),
      switchMap(({ project }) =>
        service.incidents(project).pipe(
          map((incidents) => loadIncidentsSuccess({ project, incidents })),
          catchError((error: unknown) =>
            of(loadIncidentsFailure({ project, error: apiErrorMessage(error, 'Failed to load incidents') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const createIncident$ = createEffect(
  (actions$ = inject(Actions), service = inject(StatusPagesService)) =>
    actions$.pipe(
      ofType(createIncident),
      concatMap(({ project, incident }) =>
        service.createIncident(project, incident).pipe(
          map((created) => createIncidentSuccess({ incident: created })),
          catchError((error: unknown) =>
            of(createIncidentFailure({ error: apiErrorMessage(error, 'Failed to create the incident') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const updateIncident$ = createEffect(
  (actions$ = inject(Actions), service = inject(StatusPagesService)) =>
    actions$.pipe(
      ofType(updateIncident),
      concatMap(({ project, id, update }) =>
        service.updateIncident(project, id, update).pipe(
          map((incident) => updateIncidentSuccess({ incident })),
          catchError((error: unknown) =>
            of(updateIncidentFailure({ id, error: apiErrorMessage(error, 'Failed to update the incident') })),
          ),
        ),
      ),
    ),
  { functional: true },
);
