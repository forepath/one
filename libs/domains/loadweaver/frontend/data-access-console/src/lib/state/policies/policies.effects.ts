import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { PoliciesService } from '../../services/policies.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
  loadGroupMembersFailure,
  loadGroupMembersSuccess,
  loadPolicies,
  loadPoliciesFailure,
  loadPoliciesSuccess,
} from './policies.actions';

export const loadPolicies$ = createEffect(
  (actions$ = inject(Actions), service = inject(PoliciesService)) =>
    actions$.pipe(
      ofType(loadPolicies),
      switchMap(() =>
        forkJoin({ groups: service.workloadGroups(), policies: service.policies() }).pipe(
          map(({ groups, policies }) => loadPoliciesSuccess({ groups, policies })),
          catchError((error: unknown) =>
            of(loadPoliciesFailure({ error: apiErrorMessage(error, 'Failed to load groups and policies') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Who is in which group right now: read from the map alongside the resources. */
export const loadGroupMembers$ = createEffect(
  (actions$ = inject(Actions), service = inject(PoliciesService)) =>
    actions$.pipe(
      ofType(loadPolicies),
      switchMap(() =>
        service.members().pipe(
          map((members) => loadGroupMembersSuccess({ members })),
          catchError((error: unknown) =>
            of(loadGroupMembersFailure({ error: apiErrorMessage(error, 'Failed to load group members') })),
          ),
        ),
      ),
    ),
  { functional: true },
);
