import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { billingPageWindow } from '../../constants/list-paging.constants';
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
import { selectSubscriptionMetersState } from './subscription-meters.selectors';

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
      switchMap(({ subscriptionId, page, pageSize }) => {
        const { limit, offset } = billingPageWindow(page, pageSize);

        return adminBillingService.listSubscriptionMeterEntries(subscriptionId, { limit, offset }).pipe(
          map((response) =>
            loadMeterEntriesSuccess({ subscriptionId, entries: response.items, total: response.total }),
          ),
          catchError((error) => of(loadMeterEntriesFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

/** After a create / delete the current entries page is reloaded (replace-page: server order and total). */
export const reloadMeterEntriesAfterMutation$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(createMeterEntrySuccess, deleteMeterEntrySuccess),
      withLatestFrom(store.select(selectSubscriptionMetersState)),
      map(([{ subscriptionId }, state]) =>
        loadMeterEntries({ subscriptionId, page: state.entriesPage, pageSize: state.entriesPageSize }),
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
