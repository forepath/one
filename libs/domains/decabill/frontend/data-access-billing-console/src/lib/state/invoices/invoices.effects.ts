import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, mergeMap, of, switchMap, tap } from 'rxjs';

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
      switchMap(() =>
        invoicesService.getOpenOverdueInvoices().pipe(
          map((invoices) => loadOpenOverdueInvoicesSuccess({ invoices })),
          catchError((error) => of(loadOpenOverdueInvoicesFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadHistoryInvoices$ = createEffect(
  (actions$ = inject(Actions), invoicesService = inject(InvoicesService)) => {
    return actions$.pipe(
      ofType(loadHistoryInvoices),
      switchMap(() =>
        invoicesService.getHistoryInvoices().pipe(
          map((invoices) => loadHistoryInvoicesSuccess({ invoices })),
          catchError((error) => of(loadHistoryInvoicesFailure({ error: normalizeError(error) }))),
        ),
      ),
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
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(createInvoiceSuccess),
      mergeMap(({ subscriptionId }) => [
        loadInvoices({ subscriptionId }),
        loadHistoryInvoices(),
        loadOpenOverdueInvoices(),
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
