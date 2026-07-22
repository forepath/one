import { createAction, props } from '@ngrx/store';

import type {
  AdminBillNowDto,
  AdminBillNowResponse,
  AdminBillingStatisticsParams,
  AdminBillingSummaryResponse,
  AdminInvoiceListItem,
  AdminOpenOverdueListParams,
  BillingAuditLogResponse,
  BillingStatisticsByCountry,
  BillingStatisticsByProduct,
  BillingStatisticsSummary,
  MarkInvoicePaymentStatusDto,
} from '../../types/billing.types';

export const loadAdminBillingSummary = createAction('[AdminBilling] Load Summary');
export const loadAdminBillingSummarySuccess = createAction(
  '[AdminBilling] Load Summary Success',
  props<{ summary: AdminBillingSummaryResponse }>(),
);
export const loadAdminBillingSummaryFailure = createAction(
  '[AdminBilling] Load Summary Failure',
  props<{ error: string }>(),
);

export const billNow = createAction('[AdminBilling] Bill Now', props<{ dto: AdminBillNowDto }>());
export const billNowSuccess = createAction(
  '[AdminBilling] Bill Now Success',
  props<{ result: AdminBillNowResponse }>(),
);
export const billNowFailure = createAction('[AdminBilling] Bill Now Failure', props<{ error: string }>());

export const loadAdminOpenOverdue = createAction(
  '[AdminBilling] Load Open Overdue',
  props<{ params: AdminOpenOverdueListParams }>(),
);
export const loadAdminOpenOverdueSuccess = createAction(
  '[AdminBilling] Load Open Overdue Success',
  props<{ items: AdminInvoiceListItem[]; total: number; limit: number; offset: number }>(),
);
export const loadAdminOpenOverdueFailure = createAction(
  '[AdminBilling] Load Open Overdue Failure',
  props<{ error: string }>(),
);

export const adminVoidInvoice = createAction('[AdminBilling] Void Invoice', props<{ invoiceRefId: string }>());
export const adminVoidInvoiceSuccess = createAction(
  '[AdminBilling] Void Invoice Success',
  props<{ invoice: AdminInvoiceListItem }>(),
);
export const adminVoidInvoiceFailure = createAction('[AdminBilling] Void Invoice Failure', props<{ error: string }>());

export const adminMarkPaid = createAction(
  '[AdminBilling] Mark Paid',
  props<{ invoiceRefId: string; dto?: MarkInvoicePaymentStatusDto }>(),
);
export const adminMarkPaidSuccess = createAction(
  '[AdminBilling] Mark Paid Success',
  props<{ invoice: AdminInvoiceListItem }>(),
);
export const adminMarkPaidFailure = createAction('[AdminBilling] Mark Paid Failure', props<{ error: string }>());

export const adminMarkUnpaid = createAction(
  '[AdminBilling] Mark Unpaid',
  props<{ invoiceRefId: string; dto?: MarkInvoicePaymentStatusDto }>(),
);
export const adminMarkUnpaidSuccess = createAction(
  '[AdminBilling] Mark Unpaid Success',
  props<{ invoice: AdminInvoiceListItem }>(),
);
export const adminMarkUnpaidFailure = createAction('[AdminBilling] Mark Unpaid Failure', props<{ error: string }>());

export const loadAdminStatisticsSummary = createAction(
  '[AdminBilling] Load Statistics Summary',
  props<{ params: AdminBillingStatisticsParams }>(),
);
export const loadAdminStatisticsSummarySuccess = createAction(
  '[AdminBilling] Load Statistics Summary Success',
  props<{ summary: BillingStatisticsSummary }>(),
);
export const loadAdminStatisticsSummaryFailure = createAction(
  '[AdminBilling] Load Statistics Summary Failure',
  props<{ error: string }>(),
);

export const loadAdminStatisticsByProduct = createAction(
  '[AdminBilling] Load Statistics By Product',
  props<{ params: AdminBillingStatisticsParams }>(),
);
export const loadAdminStatisticsByProductSuccess = createAction(
  '[AdminBilling] Load Statistics By Product Success',
  props<{ byProduct: BillingStatisticsByProduct }>(),
);
export const loadAdminStatisticsByProductFailure = createAction(
  '[AdminBilling] Load Statistics By Product Failure',
  props<{ error: string }>(),
);

export const loadAdminStatisticsByCountry = createAction(
  '[AdminBilling] Load Statistics By Country',
  props<{ params: AdminBillingStatisticsParams }>(),
);
export const loadAdminStatisticsByCountrySuccess = createAction(
  '[AdminBilling] Load Statistics By Country Success',
  props<{ byCountry: BillingStatisticsByCountry }>(),
);
export const loadAdminStatisticsByCountryFailure = createAction(
  '[AdminBilling] Load Statistics By Country Failure',
  props<{ error: string }>(),
);

export const loadAdminAuditLogs = createAction(
  '[AdminBilling] Load Audit Logs',
  props<{ invoiceRefId: string; limit?: number; offset?: number }>(),
);
export const loadAdminAuditLogsSuccess = createAction(
  '[AdminBilling] Load Audit Logs Success',
  props<{ invoiceRefId: string; items: BillingAuditLogResponse[]; total: number }>(),
);
export const loadAdminAuditLogsFailure = createAction(
  '[AdminBilling] Load Audit Logs Failure',
  props<{ error: string }>(),
);
