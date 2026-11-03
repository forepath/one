import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, map, mergeMap, of, switchMap, take, tap } from 'rxjs';

import { billingPageWindow } from '../../constants/list-paging.constants';
import { InvoicesService } from '../../services/invoices.service';

import {
  createInvoice,
  createInvoiceFailure,
  createInvoiceSuccess,
  initiatePayment,
  initiatePaymentFailure,
  initiatePaymentSuccess,
  loadHistoryInvoices,
  loadHistoryInvoicesFailure,
  loadHistoryInvoicesSuccess,
  loadInvoiceDetails,
  loadInvoiceDetailsFailure,
  loadInvoiceDetailsSuccess,
  loadInvoices,
  loadInvoicesFailure,
  loadInvoicesSuccess,
  loadInvoicesSummary,
  loadInvoicesSummaryFailure,
  loadInvoicesSummarySuccess,
  loadOpenOverdueInvoices,
  loadOpenOverdueInvoicesFailure,
  loadOpenOverdueInvoicesSuccess,
} from './invoices.actions';
import { selectInvoicesState } from './invoices.selectors';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

export const loadInvoicesSummary$ = createEffect(
  (actions$ = inject(Actions), invoicesService = inject(InvoicesService)) => {
    return actions$.pipe(
      ofType(loadInvoicesSummary),
      switchMap(() =>
        invoicesService.getInvoicesSummary().pipe(
          map((summary) => loadInvoicesSummarySuccess({ summary })),
          catchError((error) => of(loadInvoicesSummaryFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadOpenOverdueInvoices$ = createEffect(
  (actions$ = inject(Actions), invoicesService = inject(InvoicesService)) => {
    return actions$.pipe(
      ofType(loadOpenOverdueInvoices),
      switchMap(({ search, page, pageSize }) => {
        // Array API without a total: one extra row tells whether a next page exists (replace-page).
        const { limit, offset } = billingPageWindow(page, pageSize);

        return invoicesService.getOpenOverdueInvoices({ search, limit: limit + 1, offset }).pipe(
          map((invoices) =>
            loadOpenOverdueInvoicesSuccess({ invoices: invoices.slice(0, limit), hasMore: invoices.length > limit }),
          ),
          catchError((error) => of(loadOpenOverdueInvoicesFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadHistoryInvoices$ = createEffect(
  (actions$ = inject(Actions), invoicesService = inject(InvoicesService)) => {
    return actions$.pipe(
      ofType(loadHistoryInvoices),
      switchMap(({ search, page, pageSize }) => {
        // Array API without a total: one extra row tells whether a next page exists (replace-page).
        const { limit, offset } = billingPageWindow(page, pageSize);

        return invoicesService.getHistoryInvoices({ search, limit: limit + 1, offset }).pipe(
          map((invoices) =>
            loadHistoryInvoicesSuccess({ invoices: invoices.slice(0, limit), hasMore: invoices.length > limit }),
          ),
          catchError((error) => of(loadHistoryInvoicesFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadInvoices$ = createEffect(
  (actions$ = inject(Actions), invoicesService = inject(InvoicesService)) => {
    return actions$.pipe(
      ofType(loadInvoices),
      switchMap(({ subscriptionId }) =>
        invoicesService.listInvoices(subscriptionId).pipe(
          map((invoices) => loadInvoicesSuccess({ subscriptionId, invoices })),
          catchError((error) => of(loadInvoicesFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createInvoice$ = createEffect(
  (actions$ = inject(Actions), invoicesService = inject(InvoicesService)) => {
    return actions$.pipe(
      ofType(createInvoice),
      switchMap(({ subscriptionId, dto }) =>
        invoicesService.createInvoice(subscriptionId, dto).pipe(
          map((response) => createInvoiceSuccess({ subscriptionId, response })),
          catchError((error) => of(createInvoiceFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const reloadInvoicesAfterCreate$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) => {
    return actions$.pipe(
      ofType(createInvoiceSuccess),
      // The current page (search, page, size) of both lists, not page 1.
      switchMap(({ subscriptionId }) =>
        store.select(selectInvoicesState).pipe(
          take(1),
          map((state) => ({ subscriptionId, state })),
        ),
      ),
      mergeMap(({ subscriptionId, state }) => [
        loadInvoices({ subscriptionId }),
        loadHistoryInvoices({
          search: state?.historySearch ?? undefined,
          page: state?.historyPage,
          pageSize: state?.historyPageSize,
        }),
        loadOpenOverdueInvoices({
          search: state?.openOverdueSearch ?? undefined,
          page: state?.openOverduePage,
          pageSize: state?.openOverduePageSize,
        }),
        loadInvoicesSummary(),
      ]),
    );
  },
  { functional: true },
);

export const loadInvoiceDetails$ = createEffect(
  (actions$ = inject(Actions), invoicesService = inject(InvoicesService)) => {
    return actions$.pipe(
      ofType(loadInvoiceDetails),
      switchMap(({ subscriptionId, invoiceRefId }) =>
        invoicesService.getInvoiceDetails(subscriptionId, invoiceRefId).pipe(
          map((detail) => loadInvoiceDetailsSuccess({ invoiceRefId, detail })),
          catchError((error) => of(loadInvoiceDetailsFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const initiatePaymentRedirect$ = createEffect(
  (actions$ = inject(Actions), invoicesService = inject(InvoicesService)) => {
    return actions$.pipe(
      ofType(initiatePayment),
      switchMap(({ subscriptionId, invoiceRefId }) =>
        invoicesService.initiatePayment(subscriptionId, invoiceRefId).pipe(
          tap((response) => {
            if (response.checkoutUrl) {
              window.location.href = response.checkoutUrl;
            }
          }),
          map(() => initiatePaymentSuccess()),
          catchError((error) => of(initiatePaymentFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
