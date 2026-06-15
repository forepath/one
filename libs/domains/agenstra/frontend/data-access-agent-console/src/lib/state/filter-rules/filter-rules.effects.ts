import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { FilterRulesService } from '../../services/filter-rules.service';

import {
  createFilterRule,
  createFilterRuleFailure,
  createFilterRuleSuccess,
  deleteFilterRule,
  deleteFilterRuleFailure,
  deleteFilterRuleSuccess,
  loadFilterRules,
  loadFilterRulesBatch,
  loadFilterRulesFailure,
  loadFilterRulesSuccess,
  updateFilterRule,
  updateFilterRuleFailure,
  updateFilterRuleSuccess,
} from './filter-rules.actions';

function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    return error.error?.message ?? error.message ?? String(error.status);
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
}

const FILTER_RULES_BATCH_SIZE = 10;

export const loadFilterRules$ = createEffect(
  (actions$ = inject(Actions), svc = inject(FilterRulesService)) => {
    return actions$.pipe(
      ofType(loadFilterRules),
      switchMap(() => {
        const batchParams = { limit: FILTER_RULES_BATCH_SIZE, offset: 0 };

        return svc.list(batchParams).pipe(
          switchMap((rules) => {
            if (rules.length === 0) {
              return of(loadFilterRulesSuccess({ rules: [] }));
            }

            if (rules.length < FILTER_RULES_BATCH_SIZE) {
              return of(loadFilterRulesSuccess({ rules }));
            }

            return of(loadFilterRulesBatch({ offset: FILTER_RULES_BATCH_SIZE, accumulatedRules: rules }));
          }),
          catchError((error) => of(loadFilterRulesFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadFilterRulesBatch$ = createEffect(
  (actions$ = inject(Actions), svc = inject(FilterRulesService)) => {
    return actions$.pipe(
      ofType(loadFilterRulesBatch),
      switchMap(({ offset, accumulatedRules }) => {
        const batchParams = { limit: FILTER_RULES_BATCH_SIZE, offset };

        return svc.list(batchParams).pipe(
          switchMap((rules) => {
            const newAccumulated = [...accumulatedRules, ...rules];

            if (rules.length === 0) {
              return of(loadFilterRulesSuccess({ rules: newAccumulated }));
            }

            if (rules.length < FILTER_RULES_BATCH_SIZE) {
              return of(loadFilterRulesSuccess({ rules: newAccumulated }));
            }

            return of(
              loadFilterRulesBatch({
                offset: offset + FILTER_RULES_BATCH_SIZE,
                accumulatedRules: newAccumulated,
              }),
            );
          }),
          catchError((error) => of(loadFilterRulesFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const createFilterRule$ = createEffect(
  (actions$ = inject(Actions), svc = inject(FilterRulesService)) => {
    return actions$.pipe(
      ofType(createFilterRule),
      switchMap(({ dto }) =>
        svc.create(dto).pipe(
          map((rule) => createFilterRuleSuccess({ rule })),
          catchError((error) => of(createFilterRuleFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateFilterRule$ = createEffect(
  (actions$ = inject(Actions), svc = inject(FilterRulesService)) => {
    return actions$.pipe(
      ofType(updateFilterRule),
      switchMap(({ id, dto }) =>
        svc.update(id, dto).pipe(
          map((rule) => updateFilterRuleSuccess({ rule })),
          catchError((error) => of(updateFilterRuleFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteFilterRule$ = createEffect(
  (actions$ = inject(Actions), svc = inject(FilterRulesService)) => {
    return actions$.pipe(
      ofType(deleteFilterRule),
      switchMap(({ id }) =>
        svc.delete(id).pipe(
          map(() => deleteFilterRuleSuccess({ id })),
          catchError((error) => of(deleteFilterRuleFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
