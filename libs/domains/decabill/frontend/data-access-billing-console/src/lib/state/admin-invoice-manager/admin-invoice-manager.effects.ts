import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, mergeMap, of, switchMap } from 'rxjs';

import { billingPageWindow } from '../../constants/list-paging.constants';
import { AdminBillingService } from '../../services/admin-billing.service';

import {
  adminInvoiceManagerMarkPaid,
  adminInvoiceManagerMarkPaidFailure,
  adminInvoiceManagerMarkPaidSuccess,
  adminInvoiceManagerMarkUnpaid,
  adminInvoiceManagerMarkUnpaidFailure,
  adminInvoiceManagerMarkUnpaidSuccess,
  adminInvoiceManagerRefund,
  adminInvoiceManagerRefundFailure,
  adminInvoiceManagerRefundSuccess,
  adminInvoiceManagerSend,
  adminInvoiceManagerSendCreditNote,
  adminInvoiceManagerSendCreditNoteFailure,
  adminInvoiceManagerMarkSent,
  adminInvoiceManagerMarkSentFailure,
  adminInvoiceManagerMarkSentSuccess,
  adminInvoiceManagerSendCreditNoteSuccess,
  adminInvoiceManagerSendFailure,
  adminInvoiceManagerSendSuccess,
  adminInvoiceManagerVoid,
  adminInvoiceManagerVoidFailure,
  adminInvoiceManagerVoidSuccess,
  adminInvoiceManagerWriteOff,
  adminInvoiceManagerWriteOffFailure,
  adminInvoiceManagerWriteOffSuccess,
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
  loadAdminInvoiceManagerFailure,
  loadAdminInvoiceManagerSuccess,
  loadAdminInvoiceSettlements,
  loadAdminInvoiceSettlementsFailure,
  loadAdminInvoiceSettlementsSuccess,
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

export const loadAdminInvoiceManager$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminInvoiceManager),
      switchMap(({ search, userId, page, pageSize }) => {
        const { limit, offset } = billingPageWindow(page, pageSize);

        return service.listInvoices({ limit, offset, search, userId }).pipe(
          map((response) => loadAdminInvoiceManagerSuccess({ invoices: response.items, total: response.total })),
          catchError((error) => of(loadAdminInvoiceManagerFailure({ error: normalizeError(error) }))),
        );
      }),
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
      switchMap(({ invoiceRefId, dto, sendLetter }) =>
        service.issueManualInvoice(invoiceRefId, sendLetter ? { ...dto, notifyCustomer: false } : dto).pipe(
          mergeMap((invoice) =>
            sendLetter
              ? of(issueManualInvoiceSuccess({ invoice }), adminInvoiceManagerSend({ invoiceRefId, channel: 'letter' }))
              : of(issueManualInvoiceSuccess({ invoice })),
          ),
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
      switchMap(({ invoiceRefId, dto, sendLetter }) =>
        service.voidInvoice(invoiceRefId, sendLetter ? { ...dto, notifyCustomer: false } : dto).pipe(
          mergeMap((invoice) =>
            sendLetter
              ? of(
                  adminInvoiceManagerVoidSuccess({ invoice }),
                  adminInvoiceManagerSendCreditNote({ invoiceRefId, channel: 'letter' }),
                )
              : of(adminInvoiceManagerVoidSuccess({ invoice })),
          ),
          catchError((error) => of(adminInvoiceManagerVoidFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminInvoiceManagerSend$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminInvoiceManagerSend),
      switchMap(({ invoiceRefId, channel }) =>
        (channel === 'letter' ? service.sendInvoiceLetter(invoiceRefId) : service.sendInvoice(invoiceRefId)).pipe(
          map((invoice) => adminInvoiceManagerSendSuccess({ invoice })),
          catchError((error) => of(adminInvoiceManagerSendFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminInvoiceManagerSendCreditNote$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminInvoiceManagerSendCreditNote),
      switchMap(({ invoiceRefId, channel }) =>
        (channel === 'letter' ? service.sendCreditNoteLetter(invoiceRefId) : service.sendCreditNote(invoiceRefId)).pipe(
          map((invoice) => adminInvoiceManagerSendCreditNoteSuccess({ invoice })),
          catchError((error) => of(adminInvoiceManagerSendCreditNoteFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminInvoiceManagerMarkSent$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminInvoiceManagerMarkSent),
      switchMap(({ invoiceRefId, creditNote, dto }) =>
        (creditNote ? service.markCreditNoteSent(invoiceRefId, dto) : service.markInvoiceSent(invoiceRefId, dto)).pipe(
          map((invoice) => adminInvoiceManagerMarkSentSuccess({ invoice })),
          catchError((error) => of(adminInvoiceManagerMarkSentFailure({ error: normalizeError(error) }))),
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

export const adminInvoiceManagerWriteOff$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminInvoiceManagerWriteOff),
      switchMap(({ invoiceRefId, dto }) =>
        service.writeOffInvoice(invoiceRefId, dto).pipe(
          map((invoice) => adminInvoiceManagerWriteOffSuccess({ invoice })),
          catchError((error) => of(adminInvoiceManagerWriteOffFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const adminInvoiceManagerRefund$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(adminInvoiceManagerRefund),
      switchMap(({ invoiceRefId, dto }) =>
        service.refundInvoice(invoiceRefId, dto).pipe(
          map((invoice) => adminInvoiceManagerRefundSuccess({ invoice })),
          catchError((error) => of(adminInvoiceManagerRefundFailure({ error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadAdminInvoiceSettlements$ = createEffect(
  (actions$ = inject(Actions), service = inject(AdminBillingService)) =>
    actions$.pipe(
      ofType(loadAdminInvoiceSettlements),
      switchMap(({ invoiceRefId }) =>
        service.listInvoiceSettlements(invoiceRefId).pipe(
          map((settlements) => loadAdminInvoiceSettlementsSuccess({ invoiceRefId, settlements })),
          catchError((error) => of(loadAdminInvoiceSettlementsFailure({ invoiceRefId, error: normalizeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);
