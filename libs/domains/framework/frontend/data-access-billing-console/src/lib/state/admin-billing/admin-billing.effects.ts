import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';

import {
  adminMarkPaid,
  adminMarkPaidFailure,
  adminMarkPaidSuccess,
  adminMarkUnpaid,
  adminMarkUnpaidFailure,
  adminMarkUnpaidSuccess,
  adminVoidInvoice,
  adminVoidInvoiceFailure,
  adminVoidInvoiceSuccess,
  billNow,
  billNowFailure,
  billNowSuccess,
  loadAdminAuditLogs,
  loadAdminAuditLogsFailure,
  loadAdminAuditLogsSuccess,
  loadAdminBillingSummary,
  loadAdminBillingSummaryFailure,
  loadAdminBillingSummarySuccess,
  loadAdminOpenOverdue,
  loadAdminOpenOverdueFailure,
  loadAdminOpenOverdueSuccess,
  loadAdminStatisticsByProduct,
  loadAdminStatisticsByProductFailure,
  loadAdminStatisticsByProductSuccess,
  loadAdminStatisticsSummary,
  loadAdminStatisticsSummaryFailure,
  loadAdminStatisticsSummarySuccess,
} from './admin-billing.actions';

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) return String(error.message);

  return 'An unexpected error occurred';
}

export const loadAdminBillingSummary$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminBillingSummary),
      switchMap(() =>
        service.getSummary().pipe(
          map((summary) => loadAdminBillingSummarySuccess({ summary })),
          catchError((error) => of(loadAdminBillingSummaryFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const billNow$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(billNow),
      switchMap(({ dto }) =>
        service.billNow(dto).pipe(
          map((result) => billNowSuccess({ result })),
          catchError((error) => of(billNowFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminOpenOverdue$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminOpenOverdue),
      switchMap(({ params }) =>
        service.listOpenOverdue(params).pipe(
          map((response) =>
            loadAdminOpenOverdueSuccess({
              items: response.items,
              total: response.total,
              limit: response.limit,
              offset: response.offset,
            }),
          ),
          catchError((error) => of(loadAdminOpenOverdueFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminVoidInvoice$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminVoidInvoice),
      switchMap(({ invoiceRefId }) =>
        service.voidInvoice(invoiceRefId).pipe(
          map((invoice) => adminVoidInvoiceSuccess({ invoice })),
          catchError((error) => of(adminVoidInvoiceFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminMarkPaid$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminMarkPaid),
      switchMap(({ invoiceRefId, dto }) =>
        service.markPaid(invoiceRefId, dto).pipe(
          map((invoice) => adminMarkPaidSuccess({ invoice })),
          catchError((error) => of(adminMarkPaidFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminMarkUnpaid$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminMarkUnpaid),
      switchMap(({ invoiceRefId, dto }) =>
        service.markUnpaid(invoiceRefId, dto).pipe(
          map((invoice) => adminMarkUnpaidSuccess({ invoice })),
          catchError((error) => of(adminMarkUnpaidFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminStatisticsSummary$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminStatisticsSummary),
      switchMap(({ params }) =>
        service.getStatisticsSummary(params).pipe(
          map((summary) => loadAdminStatisticsSummarySuccess({ summary })),
          catchError((error) => of(loadAdminStatisticsSummaryFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminStatisticsByProduct$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminStatisticsByProduct),
      switchMap(({ params }) =>
        service.getStatisticsByProduct(params).pipe(
          map((byProduct) => loadAdminStatisticsByProductSuccess({ byProduct })),
          catchError((error) => of(loadAdminStatisticsByProductFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminAuditLogs$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminAuditLogs),
      switchMap(({ invoiceRefId, limit, offset }) =>
        service.listAuditLogs(invoiceRefId, limit, offset).pipe(
          map((response) =>
            loadAdminAuditLogsSuccess({
              invoiceRefId,
              items: response.items,
              total: response.total,
            }),
          ),
          catchError((error) => of(loadAdminAuditLogsFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
