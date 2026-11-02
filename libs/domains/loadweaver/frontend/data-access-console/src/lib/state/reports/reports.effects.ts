import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, concatMap, map, of, switchMap } from 'rxjs';

import { ReportsService } from '../../services/reports.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
  loadReports,
  loadReportsFailure,
  loadReportsSuccess,
  openReportFolder,
  openReportFolderFailure,
  openReportFolderSuccess,
  runReport,
  runReportFailure,
  runReportSuccess,
} from './reports.actions';

export const loadReports$ = createEffect(
  (actions$ = inject(Actions), service = inject(ReportsService)) =>
    actions$.pipe(
      ofType(loadReports),
      switchMap(() =>
        service.list().pipe(
          map((reports) => loadReportsSuccess({ reports })),
          catchError((error: unknown) =>
            of(loadReportsFailure({ error: apiErrorMessage(error, 'Failed to load reports') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const runReport$ = createEffect(
  (actions$ = inject(Actions), service = inject(ReportsService)) =>
    actions$.pipe(
      ofType(runReport),
      concatMap(({ report }) =>
        service.run(report).pipe(
          map(() => runReportSuccess({ report })),
          catchError((error: unknown) =>
            of(runReportFailure({ error: apiErrorMessage(error, 'Failed to run the report') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** A queued run shows up as pending (then running) in the list. */
export const reloadReportsAfterRun$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(runReportSuccess),
      map(() => loadReports({ silent: true })),
    ),
  { functional: true },
);

export const openReportFolder$ = createEffect(
  (actions$ = inject(Actions), service = inject(ReportsService)) =>
    actions$.pipe(
      ofType(openReportFolder),
      switchMap(({ path }) =>
        service.files(path).pipe(
          map((entries) => openReportFolderSuccess({ path, entries })),
          catchError((error: unknown) =>
            of(openReportFolderFailure({ path, error: apiErrorMessage(error, 'Failed to read the folder') })),
          ),
        ),
      ),
    ),
  { functional: true },
);
