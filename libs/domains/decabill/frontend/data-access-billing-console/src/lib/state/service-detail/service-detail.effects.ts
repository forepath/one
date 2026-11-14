import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, filter, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';
import { SubscriptionItemsService } from '../../services/subscription-items.service';
import { UsageService } from '../../services/usage.service';
import {
  subscribeBillingSubscriptionMeters,
  unsubscribeBillingSubscriptionMeters,
} from '../billing-dashboard-socket/billing-dashboard-socket.actions';
import { connectBillingDashboardSocketSuccess } from '../billing-dashboard-socket/billing-dashboard-socket.actions';
import { setSubscriptionItemDisplayName } from '../subscription-server-info/subscription-server-info.actions';

import {
  applyFilters,
  clearServiceDetail,
  enterServiceDetail,
  loadDetailFailure,
  loadDetailSuccess,
  loadHistory,
  loadHistoryFailure,
  loadHistorySuccess,
  meterSummaryPush,
  resetFilters,
  updateDisplayName,
  updateDisplayNameFailure,
  updateDisplayNameSuccess,
} from './service-detail.actions';
import { DEFAULT_METER_HISTORY_FILTERS } from './service-detail.constants';
import {
  selectServiceDetailAdminMode,
  selectServiceDetailFilters,
  selectServiceDetailSubscriptionId,
} from './service-detail.selectors';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

export const enterServiceDetail$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(enterServiceDetail),
      mergeMap(({ subscriptionId, adminMode }) => [
        subscribeBillingSubscriptionMeters({ subscriptionId }),
        loadHistory({ subscriptionId, filters: DEFAULT_METER_HISTORY_FILTERS, adminMode }),
      ]),
    ),
  { functional: true },
);

export const loadServiceDetail$ = createEffect(
  (
    actions$ = inject(Actions),
    subscriptionItemsService = inject(SubscriptionItemsService),
    adminBillingService = inject(AdminBillingService),
  ) =>
    actions$.pipe(
      ofType(enterServiceDetail),
      switchMap(({ subscriptionId, itemId, adminMode }) => {
        const request$ = adminMode
          ? adminBillingService.getAdminSubscriptionItemDetail(subscriptionId, itemId)
          : subscriptionItemsService.getItemDetail(subscriptionId, itemId);

        return request$.pipe(
          map((detail) => loadDetailSuccess({ detail })),
          catchError((error) => of(loadDetailFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const loadServiceDetailHistory$ = createEffect(
  (
    actions$ = inject(Actions),
    usageService = inject(UsageService),
    adminBillingService = inject(AdminBillingService),
  ) =>
    actions$.pipe(
      ofType(loadHistory),
      switchMap(({ subscriptionId, filters, adminMode }) => {
        const request$ = adminMode
          ? adminBillingService.getAdminSubscriptionMeterHistory(subscriptionId, filters)
          : usageService.getSubscriptionMeterHistory(subscriptionId, filters);

        return request$.pipe(
          map((history) => loadHistorySuccess({ history })),
          catchError((error) => of(loadHistoryFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const reloadServiceDetailHistoryOnFilters$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(applyFilters, resetFilters),
      withLatestFrom(store.select(selectServiceDetailSubscriptionId)),
      filter(([, subscriptionId]) => !!subscriptionId),
      mergeMap(([action, subscriptionId]) => {
        const filters = action.type === resetFilters.type ? DEFAULT_METER_HISTORY_FILTERS : action.filters;

        return [
          loadHistory({
            subscriptionId: subscriptionId!,
            filters,
            adminMode: action.adminMode,
          }),
        ];
      }),
    ),
  { functional: true },
);

export const reloadServiceDetailHistoryOnMeterPush$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(meterSummaryPush),
      withLatestFrom(
        store.select(selectServiceDetailSubscriptionId),
        store.select(selectServiceDetailAdminMode),
        store.select(selectServiceDetailFilters),
      ),
      filter(
        ([{ subscriptionId }, activeSubscriptionId]) =>
          !!activeSubscriptionId && subscriptionId === activeSubscriptionId,
      ),
      map(([, subscriptionId, adminMode, filters]) =>
        loadHistory({
          subscriptionId: subscriptionId!,
          filters,
          adminMode,
        }),
      ),
    ),
  { functional: true },
);

export const updateServiceDetailDisplayName$ = createEffect(
  (
    actions$ = inject(Actions),
    subscriptionItemsService = inject(SubscriptionItemsService),
    adminBillingService = inject(AdminBillingService),
  ) =>
    actions$.pipe(
      ofType(updateDisplayName),
      switchMap(({ subscriptionId, itemId, displayName, adminMode }) => {
        const request$ = adminMode
          ? adminBillingService.updateAdminSubscriptionItemDisplayName(subscriptionId, itemId, displayName)
          : subscriptionItemsService.updateDisplayName(subscriptionId, itemId, displayName);

        return request$.pipe(
          mergeMap(() => [
            updateDisplayNameSuccess({ subscriptionId, itemId, displayName }),
            setSubscriptionItemDisplayName({ subscriptionId, displayName }),
          ]),
          catchError((error) => of(updateDisplayNameFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const clearServiceDetail$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(clearServiceDetail),
      withLatestFrom(store.select(selectServiceDetailSubscriptionId)),
      mergeMap(([, subscriptionId]) =>
        subscriptionId ? [unsubscribeBillingSubscriptionMeters({ subscriptionId })] : [],
      ),
    ),
  { functional: true },
);

export const restoreServiceDetailMetersSubscription$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(connectBillingDashboardSocketSuccess),
      withLatestFrom(store.select(selectServiceDetailSubscriptionId)),
      filter(([, subscriptionId]) => !!subscriptionId),
      map(([, subscriptionId]) => subscribeBillingSubscriptionMeters({ subscriptionId: subscriptionId! })),
    ),
  { functional: true },
);
