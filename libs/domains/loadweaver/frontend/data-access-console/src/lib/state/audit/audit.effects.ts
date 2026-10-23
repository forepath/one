import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, exhaustMap, filter, map, of, switchMap, withLatestFrom } from 'rxjs';

import { ConsoleAuditService } from '../../services/audit.service';
import type { AuditFilter } from '../../types/audit.types';
import { apiErrorMessage } from '../../utils/api-error';
import {
  loadAuditPage,
  loadAuditPageFailure,
  loadAuditPageSuccess,
  nextAuditPage,
  previousAuditPage,
  searchAudit,
  verifyAudit,
  verifyAuditFailure,
  verifyAuditSuccess,
} from './audit.actions';
import { selectConsoleAuditState } from './audit.selectors';

export const searchAudit$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(searchAudit),
      map(() => loadAuditPage({ page: 0, before: null })),
    ),
  { functional: true },
);

export const auditPageNavigation$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(nextAuditPage, previousAuditPage),
      withLatestFrom(store.select(selectConsoleAuditState)),
      filter(([action, state]) =>
        action.type === nextAuditPage.type ? state.nextBefore !== null && !state.loading : state.page > 0,
      ),
      map(([action, state]) =>
        action.type === nextAuditPage.type
          ? loadAuditPage({ page: state.page + 1, before: state.nextBefore })
          : loadAuditPage({ page: state.page - 1, before: state.cursors[state.page - 1] ?? null }),
      ),
    ),
  { functional: true },
);

export const loadAuditPage$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), service = inject(ConsoleAuditService)) =>
    actions$.pipe(
      ofType(loadAuditPage),
      withLatestFrom(store.select(selectConsoleAuditState)),
      filter(([, state]) => state.filter !== null),
      switchMap(([{ page, before }, state]) =>
        service.list({ ...(state.filter as AuditFilter), limit: state.limit, ...(before ? { before } : {}) }).pipe(
          map((result) => loadAuditPageSuccess({ page, result })),
          catchError((error: unknown) =>
            of(loadAuditPageFailure({ page, error: apiErrorMessage(error, 'Failed to load the audit log') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const verifyAudit$ = createEffect(
  (actions$ = inject(Actions), service = inject(ConsoleAuditService)) =>
    actions$.pipe(
      ofType(verifyAudit),
      exhaustMap(() =>
        service.verify().pipe(
          map((verification) => verifyAuditSuccess({ verification, at: new Date().toISOString() })),
          catchError((error: unknown) =>
            of(verifyAuditFailure({ error: apiErrorMessage(error, 'Failed to verify the audit log') })),
          ),
        ),
      ),
    ),
  { functional: true },
);
