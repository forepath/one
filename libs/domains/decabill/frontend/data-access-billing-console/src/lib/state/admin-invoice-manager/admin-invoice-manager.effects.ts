import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';

import {
  adminInvoiceManagerMarkPaid,
  adminInvoiceManagerMarkPaidFailure,
  adminInvoiceManagerMarkPaidSuccess,
  adminInvoiceManagerMarkUnpaid,
  adminInvoiceManagerMarkUnpaidFailure,
  adminInvoiceManagerMarkUnpaidSuccess,
  adminInvoiceManagerVoid,
  adminInvoiceManagerVoidFailure,
  adminInvoiceManagerVoidSuccess,
  createManualInvoice,
  createManualInvoiceFailure,
  createManualInvoiceSuccess,
  deleteManualInvoice,
  deleteManualInvoiceFailure,
  deleteManualInvoiceSuccess,
  issueManualInvoice,
  issueManualInvoiceFailure,
  issueManualInvoiceSuccess,
  loadAdminInvoiceManager,
  loadAdminInvoiceManagerBatch,
  loadAdminInvoiceManagerFailure,
  loadAdminInvoiceManagerSuccess,
  updateManualInvoice,
  updateManualInvoiceFailure,
  updateManualInvoiceSuccess,
} from './admin-invoice-manager.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

const BATCH_SIZE = 10;

export const loadAdminInvoiceManager$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminInvoiceManager),
      switchMap(() =>
        service.listInvoices({ limit: BATCH_SIZE, offset: 0 }).pipe(
          switchMap((response) => {
            if (response.items.length === 0) {
              return of(loadAdminInvoiceManagerSuccess({ invoices: [] }));
            }

            if (response.items.length < BATCH_SIZE) {
              return of(loadAdminInvoiceManagerSuccess({ invoices: response.items }));
            }

            return of(loadAdminInvoiceManagerBatch({ offset: BATCH_SIZE, accumulatedInvoices: response.items }));
          }),
          catchError((error) => of(loadAdminInvoiceManagerFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminInvoiceManagerBatch$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminInvoiceManagerBatch),
      switchMap(({ offset, accumulatedInvoices }) =>
        service.listInvoices({ limit: BATCH_SIZE, offset }).pipe(
          switchMap((response) => {
            const newAccumulated = [...accumulatedInvoices, ...response.items];

            if (response.items.length === 0 || response.items.length < BATCH_SIZE) {
              return of(loadAdminInvoiceManagerSuccess({ invoices: newAccumulated }));
            }

            return of(
              loadAdminInvoiceManagerBatch({
                offset: offset + BATCH_SIZE,
                accumulatedInvoices: newAccumulated,
              }),
            );
          }),
          catchError((error) => of(loadAdminInvoiceManagerFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createManualInvoice$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(createManualInvoice),
      switchMap(({ dto }) =>
        service.createManualInvoice(dto).pipe(
          map((invoice) => createManualInvoiceSuccess({ invoice })),
          catchError((error) => of(createManualInvoiceFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateManualInvoice$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(updateManualInvoice),
      switchMap(({ invoiceRefId, dto }) =>
        service.updateManualInvoice(invoiceRefId, dto).pipe(
          map((invoice) => updateManualInvoiceSuccess({ invoice })),
          catchError((error) => of(updateManualInvoiceFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const issueManualInvoice$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(issueManualInvoice),
      switchMap(({ invoiceRefId, dto }) =>
        service.issueManualInvoice(invoiceRefId, dto).pipe(
          map((invoice) => issueManualInvoiceSuccess({ invoice })),
          catchError((error) => of(issueManualInvoiceFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteManualInvoice$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(deleteManualInvoice),
      switchMap(({ invoiceRefId }) =>
        service.deleteManualInvoice(invoiceRefId).pipe(
          map(() => deleteManualInvoiceSuccess({ invoiceRefId })),
          catchError((error) => of(deleteManualInvoiceFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminInvoiceManagerVoid$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminInvoiceManagerVoid),
      switchMap(({ invoiceRefId }) =>
        service.voidInvoice(invoiceRefId).pipe(
          map((invoice) => adminInvoiceManagerVoidSuccess({ invoice })),
          catchError((error) => of(adminInvoiceManagerVoidFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminInvoiceManagerMarkPaid$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminInvoiceManagerMarkPaid),
      switchMap(({ invoiceRefId, dto }) =>
        service.markPaid(invoiceRefId, dto).pipe(
          map((invoice) => adminInvoiceManagerMarkPaidSuccess({ invoice })),
          catchError((error) => of(adminInvoiceManagerMarkPaidFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminInvoiceManagerMarkUnpaid$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminInvoiceManagerMarkUnpaid),
      switchMap(({ invoiceRefId, dto }) =>
        service.markUnpaid(invoiceRefId, dto).pipe(
          map((invoice) => adminInvoiceManagerMarkUnpaidSuccess({ invoice })),
          catchError((error) => of(adminInvoiceManagerMarkUnpaidFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
