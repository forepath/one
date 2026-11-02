import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, concatMap, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { AlertsService } from '../../services/alerts.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
  acknowledgeAlert,
  acknowledgeAlertFailure,
  acknowledgeAlertSuccess,
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
import { selectSilencesExpired } from './alerts.selectors';

export const loadAlerts$ = createEffect(
  (actions$ = inject(Actions), service = inject(AlertsService)) =>
    actions$.pipe(
      ofType(loadAlerts),
      switchMap(({ query }) =>
        service.list(query).pipe(
          map((alerts) => loadAlertsSuccess({ alerts })),
          catchError((error: unknown) =>
            of(loadAlertsFailure({ error: apiErrorMessage(error, 'Failed to load alerts') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadAlert$ = createEffect(
  (actions$ = inject(Actions), service = inject(AlertsService)) =>
    actions$.pipe(
      ofType(loadAlert),
      switchMap(({ id }) =>
        service.get(id).pipe(
          map((alert) => loadAlertSuccess({ alert })),
          catchError((error: unknown) =>
            of(loadAlertFailure({ id, error: apiErrorMessage(error, 'Failed to load the alert') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const acknowledgeAlert$ = createEffect(
  (actions$ = inject(Actions), service = inject(AlertsService)) =>
    actions$.pipe(
      ofType(acknowledgeAlert),
      mergeMap(({ id }) =>
        service.acknowledge(id).pipe(
          map((alert) => acknowledgeAlertSuccess({ alert })),
          catchError((error: unknown) =>
            of(acknowledgeAlertFailure({ id, error: apiErrorMessage(error, 'Failed to acknowledge the alert') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadSilences$ = createEffect(
  (actions$ = inject(Actions), service = inject(AlertsService)) =>
    actions$.pipe(
      ofType(loadSilences),
      switchMap(({ expired }) =>
        service.silences(expired).pipe(
          map((silences) => loadSilencesSuccess({ silences })),
          catchError((error: unknown) =>
            of(loadSilencesFailure({ error: apiErrorMessage(error, 'Failed to load silences') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const createSilence$ = createEffect(
  (actions$ = inject(Actions), service = inject(AlertsService)) =>
    actions$.pipe(
      ofType(createSilence),
      concatMap(({ silence }) =>
        service.createSilence(silence).pipe(
          map((created) => createSilenceSuccess({ silence: created })),
          catchError((error: unknown) =>
            of(createSilenceFailure({ error: apiErrorMessage(error, 'Failed to create the silence') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const endSilence$ = createEffect(
  (actions$ = inject(Actions), service = inject(AlertsService)) =>
    actions$.pipe(
      ofType(endSilence),
      mergeMap(({ id }) =>
        service.endSilence(id).pipe(
          map(() => endSilenceSuccess({ id })),
          catchError((error: unknown) =>
            of(endSilenceFailure({ id, error: apiErrorMessage(error, 'Failed to end the silence') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** An ended silence stays as history: the list is read again (with or without the expired ones, as shown). */
export const reloadSilencesAfterEnd$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(endSilenceSuccess),
      withLatestFrom(store.select(selectSilencesExpired)),
      map(([, expired]) => loadSilences({ expired })),
    ),
  { functional: true },
);
