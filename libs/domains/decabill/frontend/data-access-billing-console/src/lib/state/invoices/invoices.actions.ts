import { createAction, props } from '@ngrx/store';

import type {
  CreateInvoiceDto,
  CreateInvoiceResponse,
  InvoiceDetailResponse,
  InvoiceResponse,
  InvoicesSummaryResponse,
} from '../../types/billing.types';

export const loadInvoicesSummary = createAction('[Invoices] Load Summary', (silent = false) => ({ silent }));
export const loadInvoicesSummarySuccess = createAction(
  '[Invoices] Load Summary Success',
  props<{ summary: InvoicesSummaryResponse }>(),
);
export const loadInvoicesSummaryFailure = createAction('[Invoices] Load Summary Failure', props<{ error: string }>());

export const loadOpenOverdueInvoices = createAction('[Invoices] Load Open Overdue Invoices', (silent = false) => ({
  silent,
}));
export const loadOpenOverdueInvoicesSuccess = createAction(
  '[Invoices] Load Open Overdue Invoices Success',
  props<{ invoices: InvoiceResponse[] }>(),
);
export const loadOpenOverdueInvoicesFailure = createAction(
  '[Invoices] Load Open Overdue Invoices Failure',
  props<{ error: string }>(),
);

export const loadInvoices = createAction(
  '[Invoices] Load Invoices',
  props<{ subscriptionId: string; silent?: boolean }>(),
);
export const loadInvoicesSuccess = createAction(
  '[Invoices] Load Invoices Success',
  props<{ subscriptionId: string; invoices: InvoiceResponse[] }>(),
);
export const loadInvoicesFailure = createAction('[Invoices] Load Invoices Failure', props<{ error: string }>());

export const createInvoice = createAction(
  '[Invoices] Create Invoice',
  props<{ subscriptionId: string; dto?: CreateInvoiceDto }>(),
);
export const createInvoiceSuccess = createAction(
  '[Invoices] Create Invoice Success',
  props<{ subscriptionId: string; response: CreateInvoiceResponse }>(),
);
export const createInvoiceFailure = createAction('[Invoices] Create Invoice Failure', props<{ error: string }>());

export const loadInvoiceDetails = createAction(
  '[Invoices] Load Invoice Details',
  props<{ subscriptionId?: string; invoiceRefId: string; silent?: boolean }>(),
);
export const loadInvoiceDetailsSuccess = createAction(
  '[Invoices] Load Invoice Details Success',
  props<{ invoiceRefId: string; detail: InvoiceDetailResponse }>(),
);
export const loadInvoiceDetailsFailure = createAction(
  '[Invoices] Load Invoice Details Failure',
  props<{ error: string }>(),
);

export const initiatePayment = createAction(
  '[Invoices] Initiate Payment',
  props<{ subscriptionId?: string; invoiceRefId: string }>(),
);
export const initiatePaymentSuccess = createAction('[Invoices] Initiate Payment Success');
export const initiatePaymentFailure = createAction('[Invoices] Initiate Payment Failure', props<{ error: string }>());

export const clearInvoices = createAction('[Invoices] Clear Invoices');
