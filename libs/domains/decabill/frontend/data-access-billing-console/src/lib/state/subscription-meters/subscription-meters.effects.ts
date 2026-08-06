import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, mergeMap, of, switchMap } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';
import { UsageService } from '../../services/usage.service';

import {
  createMeterEntry,
  createMeterEntryFailure,
  createMeterEntrySuccess,
  deleteMeterEntry,
  deleteMeterEntryFailure,
  deleteMeterEntrySuccess,
  loadMeterEntries,
  loadMeterEntriesFailure,
  loadMeterEntriesSuccess,
  loadSubscriptionMeters,
  loadSubscriptionMetersFailure,
  loadSubscriptionMetersSuccess,
  updateMeterEntry,
  updateMeterEntryFailure,
  updateMeterEntrySuccess,
} from './subscription-meters.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

export const loadSubscriptionMeters$ = createEffect(
  (actions$ = inject(Actions), usageService = inject(UsageService)) =>
    actions$.pipe(
      ofType(loadSubscriptionMeters),
      switchMap(({ subscriptionId }) =>
        usageService.getSubscriptionMeters(subscriptionId).pipe(
          map((summaries) => loadSubscriptionMetersSuccess({ subscriptionId, summaries })),
          catchError((error) => of(loadSubscriptionMetersFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadMeterEntries$ = createEffect(
  (actions$ = inject(Actions), adminBillingService = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadMeterEntries),
      switchMap(({ subscriptionId }) =>
        adminBillingService.listSubscriptionMeterEntries(subscriptionId).pipe(
          map((entries) => loadMeterEntriesSuccess({ subscriptionId, entries })),
          catchError((error) => of(loadMeterEntriesFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createMeterEntry$ = createEffect(
  (actions$ = inject(Actions), adminBillingService = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(createMeterEntry),
      switchMap(({ subscriptionId, entry }) =>
        adminBillingService.createSubscriptionMeterEntry(subscriptionId, entry).pipe(
          mergeMap((created) => [
            createMeterEntrySuccess({ subscriptionId, entry: created }),
            loadSubscriptionMeters({ subscriptionId }),
          ]),
          catchError((error) => of(createMeterEntryFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateMeterEntry$ = createEffect(
  (actions$ = inject(Actions), adminBillingService = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(updateMeterEntry),
      switchMap(({ subscriptionId, entryId, entry }) =>
        adminBillingService.updateSubscriptionMeterEntry(subscriptionId, entryId, entry).pipe(
          mergeMap((updated) => [
            updateMeterEntrySuccess({ subscriptionId, entry: updated }),
            loadSubscriptionMeters({ subscriptionId }),
          ]),
          catchError((error) => of(updateMeterEntryFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteMeterEntry$ = createEffect(
  (actions$ = inject(Actions), adminBillingService = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(deleteMeterEntry),
      switchMap(({ subscriptionId, entryId }) =>
        adminBillingService.deleteSubscriptionMeterEntry(subscriptionId, entryId).pipe(
          mergeMap(() => [
            deleteMeterEntrySuccess({ subscriptionId, entryId }),
            loadSubscriptionMeters({ subscriptionId }),
          ]),
          catchError((error) => of(deleteMeterEntryFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
