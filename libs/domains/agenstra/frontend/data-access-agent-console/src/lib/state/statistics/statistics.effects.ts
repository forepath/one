import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { StatisticsService } from '../../services/statistics.service';

import {
  loadClientStatisticsChatIo,
  loadClientStatisticsChatIoFailure,
  loadClientStatisticsChatIoSuccess,
  loadClientStatisticsEntityEvents,
  loadClientStatisticsEntityEventsFailure,
  loadClientStatisticsEntityEventsSuccess,
  loadClientStatisticsFilterDrops,
  loadClientStatisticsFilterDropsFailure,
  loadClientStatisticsFilterDropsSuccess,
  loadClientStatisticsFilterFlags,
  loadClientStatisticsFilterFlagsFailure,
  loadClientStatisticsFilterFlagsSuccess,
  loadClientStatisticsSummary,
  loadClientStatisticsSummaryFailure,
  loadClientStatisticsSummarySuccess,
  loadStatisticsChatIo,
  loadStatisticsChatIoFailure,
  loadStatisticsChatIoSuccess,
  loadStatisticsEntityEvents,
  loadStatisticsEntityEventsFailure,
  loadStatisticsEntityEventsSuccess,
  loadStatisticsFilterDrops,
  loadStatisticsFilterDropsFailure,
  loadStatisticsFilterDropsSuccess,
  loadStatisticsFilterFlags,
  loadStatisticsFilterFlagsFailure,
  loadStatisticsFilterFlagsSuccess,
  loadStatisticsSummary,
  loadStatisticsSummaryFailure,
  loadStatisticsSummarySuccess,
} from './statistics.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);

  return 'An unexpected error occurred';
}

export const loadClientStatisticsSummary$ = createEffect(
  (actions$ = inject(Actions), statisticsService = inject(StatisticsService)) =>
    actions$.pipe(
      ofType(loadClientStatisticsSummary),
      switchMap(({ clientId, params }) =>
        statisticsService.getClientSummary(clientId, params).pipe(
          map((summary) => loadClientStatisticsSummarySuccess({ clientId, summary })),
          catchError((error) => of(loadClientStatisticsSummaryFailure({ clientId, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadClientStatisticsChatIo$ = createEffect(
  (actions$ = inject(Actions), statisticsService = inject(StatisticsService)) =>
    actions$.pipe(
      ofType(loadClientStatisticsChatIo),
      switchMap(({ params }) =>
        statisticsService.getClientChatIo(params.clientId, params).pipe(
          map((data) => loadClientStatisticsChatIoSuccess({ clientId: params.clientId, data })),
          catchError((error) =>
            of(loadClientStatisticsChatIoFailure({ clientId: params.clientId, error: normalizeError(error) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadClientStatisticsFilterDrops$ = createEffect(
  (actions$ = inject(Actions), statisticsService = inject(StatisticsService)) =>
    actions$.pipe(
      ofType(loadClientStatisticsFilterDrops),
      switchMap(({ params }) =>
        statisticsService.getClientFilterDrops(params.clientId, params).pipe(
          map((data) => loadClientStatisticsFilterDropsSuccess({ clientId: params.clientId, data })),
          catchError((error) =>
            of(loadClientStatisticsFilterDropsFailure({ clientId: params.clientId, error: normalizeError(error) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadClientStatisticsFilterFlags$ = createEffect(
  (actions$ = inject(Actions), statisticsService = inject(StatisticsService)) =>
    actions$.pipe(
      ofType(loadClientStatisticsFilterFlags),
      switchMap(({ params }) =>
        statisticsService.getClientFilterFlags(params.clientId, params).pipe(
          map((data) => loadClientStatisticsFilterFlagsSuccess({ clientId: params.clientId, data })),
          catchError((error) =>
            of(loadClientStatisticsFilterFlagsFailure({ clientId: params.clientId, error: normalizeError(error) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadClientStatisticsEntityEvents$ = createEffect(
  (actions$ = inject(Actions), statisticsService = inject(StatisticsService)) =>
    actions$.pipe(
      ofType(loadClientStatisticsEntityEvents),
      switchMap(({ params }) =>
        statisticsService.getClientEntityEvents(params.clientId, params).pipe(
          map((data) => loadClientStatisticsEntityEventsSuccess({ clientId: params.clientId, data })),
          catchError((error) =>
            of(loadClientStatisticsEntityEventsFailure({ clientId: params.clientId, error: normalizeError(error) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadStatisticsSummary$ = createEffect(
  (actions$ = inject(Actions), statisticsService = inject(StatisticsService)) =>
    actions$.pipe(
      ofType(loadStatisticsSummary),
      switchMap(({ params }) =>
        statisticsService.getSummary(params).pipe(
          map((summary) => loadStatisticsSummarySuccess({ summary })),
          catchError((error) => of(loadStatisticsSummaryFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadStatisticsChatIo$ = createEffect(
  (actions$ = inject(Actions), statisticsService = inject(StatisticsService)) =>
    actions$.pipe(
      ofType(loadStatisticsChatIo),
      switchMap(({ params }) =>
        statisticsService.getChatIo(params).pipe(
          map((data) => loadStatisticsChatIoSuccess({ data })),
          catchError((error) => of(loadStatisticsChatIoFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadStatisticsFilterDrops$ = createEffect(
  (actions$ = inject(Actions), statisticsService = inject(StatisticsService)) =>
    actions$.pipe(
      ofType(loadStatisticsFilterDrops),
      switchMap(({ params }) =>
        statisticsService.getFilterDrops(params).pipe(
          map((data) => loadStatisticsFilterDropsSuccess({ data })),
          catchError((error) => of(loadStatisticsFilterDropsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadStatisticsFilterFlags$ = createEffect(
  (actions$ = inject(Actions), statisticsService = inject(StatisticsService)) =>
    actions$.pipe(
      ofType(loadStatisticsFilterFlags),
      switchMap(({ params }) =>
        statisticsService.getFilterFlags(params).pipe(
          map((data) => loadStatisticsFilterFlagsSuccess({ data })),
          catchError((error) => of(loadStatisticsFilterFlagsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadStatisticsEntityEvents$ = createEffect(
  (actions$ = inject(Actions), statisticsService = inject(StatisticsService)) =>
    actions$.pipe(
      ofType(loadStatisticsEntityEvents),
      switchMap(({ params }) =>
        statisticsService.getEntityEvents(params).pipe(
          map((data) => loadStatisticsEntityEventsSuccess({ data })),
          catchError((error) => of(loadStatisticsEntityEventsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
