import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { billingPageWindow } from '../../constants/list-paging.constants';
import { AdminSupplierInvoicesService } from '../../services/admin-supplier-invoices.service';

import {
  adminSupplierInvoiceManagerMarkPaid,
  adminSupplierInvoiceManagerMarkPaidFailure,
  adminSupplierInvoiceManagerMarkPaidSuccess,
  adminSupplierInvoiceManagerMarkUnpaid,
  adminSupplierInvoiceManagerMarkUnpaidFailure,
  adminSupplierInvoiceManagerMarkUnpaidSuccess,
  adminSupplierInvoiceManagerVoid,
  adminSupplierInvoiceManagerVoidFailure,
  adminSupplierInvoiceManagerVoidSuccess,
  createSupplierInvoice,
  createSupplierInvoiceFailure,
  createSupplierInvoiceSuccess,
  deleteSupplierInvoice,
  deleteSupplierInvoiceFailure,
  deleteSupplierInvoiceSuccess,
  issueSupplierInvoice,
  issueSupplierInvoiceFailure,
  issueSupplierInvoiceSuccess,
  loadAdminSupplierInvoiceManager,
  loadAdminSupplierInvoiceManagerFailure,
  loadAdminSupplierInvoiceManagerSuccess,
  loadAdminSupplierInvoiceSummary,
  loadAdminSupplierInvoiceSummaryFailure,
  loadAdminSupplierInvoiceSummarySuccess,
  parseSupplierInvoiceDocument,
  parseSupplierInvoiceDocumentFailure,
  parseSupplierInvoiceDocumentSuccess,
  updateSupplierInvoice,
  updateSupplierInvoiceFailure,
  updateSupplierInvoiceSuccess,
} from './admin-supplier-invoice-manager.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

export const loadAdminSupplierInvoiceSummary$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierInvoicesService)) =>
    actions$.pipe(
      ofType(loadAdminSupplierInvoiceSummary),
      switchMap(({ params }) =>
        service.getSummary(params).pipe(
          map((summary) => loadAdminSupplierInvoiceSummarySuccess({ summary })),
          catchError((error) => of(loadAdminSupplierInvoiceSummaryFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminSupplierInvoiceManager$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierInvoicesService)) =>
    actions$.pipe(
      ofType(loadAdminSupplierInvoiceManager),
      switchMap(({ search, status, page, pageSize }) => {
        const { limit, offset } = billingPageWindow(page, pageSize);

        return service.list({ limit, offset, search, status }).pipe(
          map((response) =>
            loadAdminSupplierInvoiceManagerSuccess({ invoices: response.items, total: response.total }),
          ),
          catchError((error) => of(loadAdminSupplierInvoiceManagerFailure({ error: normalizeError(error) }))),
        );
      }),
    ),
  { functional: true },
);

export const parseSupplierInvoiceDocument$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierInvoicesService)) =>
    actions$.pipe(
      ofType(parseSupplierInvoiceDocument),
      switchMap(({ file }) =>
        service.parseDocument(file).pipe(
          map((preview) => parseSupplierInvoiceDocumentSuccess({ preview })),
          catchError((error) => of(parseSupplierInvoiceDocumentFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const createSupplierInvoice$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierInvoicesService)) =>
    actions$.pipe(
      ofType(createSupplierInvoice),
      switchMap(({ formData }) =>
        service.create(formData).pipe(
          map((invoice) => createSupplierInvoiceSuccess({ invoice })),
          catchError((error) => of(createSupplierInvoiceFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const updateSupplierInvoice$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierInvoicesService)) =>
    actions$.pipe(
      ofType(updateSupplierInvoice),
      switchMap(({ invoiceId, dto }) =>
        service.update(invoiceId, dto).pipe(
          map((invoice) => updateSupplierInvoiceSuccess({ invoice })),
          catchError((error) => of(updateSupplierInvoiceFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const issueSupplierInvoice$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierInvoicesService)) =>
    actions$.pipe(
      ofType(issueSupplierInvoice),
      switchMap(({ invoiceId, dto }) =>
        service.issue(invoiceId, dto).pipe(
          map((invoice) => issueSupplierInvoiceSuccess({ invoice })),
          catchError((error) => of(issueSupplierInvoiceFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteSupplierInvoice$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierInvoicesService)) =>
    actions$.pipe(
      ofType(deleteSupplierInvoice),
      switchMap(({ invoiceId }) =>
        service.delete(invoiceId).pipe(
          map(() => deleteSupplierInvoiceSuccess({ invoiceId })),
          catchError((error) => of(deleteSupplierInvoiceFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminSupplierInvoiceManagerVoid$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierInvoicesService)) =>
    actions$.pipe(
      ofType(adminSupplierInvoiceManagerVoid),
      switchMap(({ invoiceId }) =>
        service.void(invoiceId).pipe(
          map((invoice) => adminSupplierInvoiceManagerVoidSuccess({ invoice })),
          catchError((error) => of(adminSupplierInvoiceManagerVoidFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminSupplierInvoiceManagerMarkPaid$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierInvoicesService)) =>
    actions$.pipe(
      ofType(adminSupplierInvoiceManagerMarkPaid),
      switchMap(({ invoiceId, dto }) =>
        service.markPaid(invoiceId, dto).pipe(
          map((invoice) => adminSupplierInvoiceManagerMarkPaidSuccess({ invoice })),
          catchError((error) => of(adminSupplierInvoiceManagerMarkPaidFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminSupplierInvoiceManagerMarkUnpaid$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminSupplierInvoicesService)) =>
    actions$.pipe(
      ofType(adminSupplierInvoiceManagerMarkUnpaid),
      switchMap(({ invoiceId, dto }) =>
        service.markUnpaid(invoiceId, dto).pipe(
          map((invoice) => adminSupplierInvoiceManagerMarkUnpaidSuccess({ invoice })),
          catchError((error) => of(adminSupplierInvoiceManagerMarkUnpaidFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
