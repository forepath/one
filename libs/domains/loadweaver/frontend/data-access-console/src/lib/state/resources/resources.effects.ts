import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, exhaustMap, filter, map, mergeMap, of, switchMap, tap, withLatestFrom } from 'rxjs';

import { PlansService } from '../../services/plans.service';
import { ResourcesService } from '../../services/resources.service';
import { apiErrorMessage } from '../../utils/api-error';
import { hasOwnKey } from '../../utils/json-schema';
import {
  loadResource,
  loadResourceFailure,
  loadResourceKinds,
  loadResourceKindsFailure,
  loadResourceKindsSuccess,
  loadResources,
  loadResourceSchema,
  loadResourceSchemaFailure,
  loadResourceSchemaSuccess,
  loadResourcesFailure,
  loadResourcesSuccess,
  loadResourceSuccess,
  planResourceChange,
  planResourceChangeFailure,
  planResourceChangeSuccess,
} from './resources.actions';
import { selectResourceSchemas } from './resources.selectors';

export const loadResources$ = createEffect(
  (actions$ = inject(Actions), service = inject(ResourcesService)) =>
    actions$.pipe(
      ofType(loadResources),
      switchMap(() =>
        service.list().pipe(
          map((resources) => loadResourcesSuccess({ resources })),
          catchError((error: unknown) =>
            of(loadResourcesFailure({ error: apiErrorMessage(error, 'Failed to load resources') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadResource$ = createEffect(
  (actions$ = inject(Actions), service = inject(ResourcesService)) =>
    actions$.pipe(
      ofType(loadResource),
      switchMap(({ key }) =>
        service.get(key).pipe(
          map((resource) => loadResourceSuccess({ resource })),
          catchError((error: unknown) =>
            of(loadResourceFailure({ key, error: apiErrorMessage(error, 'Failed to load the resource') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadResourceKinds$ = createEffect(
  (actions$ = inject(Actions), service = inject(ResourcesService)) =>
    actions$.pipe(
      ofType(loadResourceKinds),
      exhaustMap(() =>
        service.kinds().pipe(
          map((kinds) => loadResourceKindsSuccess({ kinds })),
          catchError((error: unknown) =>
            of(loadResourceKindsFailure({ error: apiErrorMessage(error, 'Failed to load the resource kinds') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Schemas don't change while the console runs: each kind's is read once. */
export const loadResourceSchema$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), service = inject(ResourcesService)) =>
    actions$.pipe(
      ofType(loadResourceSchema),
      withLatestFrom(store.select(selectResourceSchemas)),
      filter(([{ kind }, schemas]) => !hasOwnKey(schemas, kind)),
      mergeMap(([{ kind }]) =>
        service.schema(kind).pipe(
          map((schema) => loadResourceSchemaSuccess({ kind, schema })),
          catchError((error: unknown) =>
            of(loadResourceSchemaFailure({ kind, error: apiErrorMessage(error, `Failed to load the ${kind} schema`) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const planResourceChange$ = createEffect(
  (actions$ = inject(Actions), plans = inject(PlansService)) =>
    actions$.pipe(
      ofType(planResourceChange),
      exhaustMap(({ request }) =>
        plans.create(request).pipe(
          map((plan) => planResourceChangeSuccess({ plan })),
          catchError((error: unknown) =>
            of(planResourceChangeFailure({ error: apiErrorMessage(error, 'Failed to plan the change') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** The planned change is reviewed (and approved / applied) on the plan. */
export const openResourcePlan$ = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) =>
    actions$.pipe(
      ofType(planResourceChangeSuccess),
      tap(({ plan }) => void router.navigate(['/plans', plan.id])),
    ),
  { functional: true, dispatch: false },
);
