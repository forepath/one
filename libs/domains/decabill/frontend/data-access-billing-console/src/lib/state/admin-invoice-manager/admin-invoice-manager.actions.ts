import { createAction, props } from '@ngrx/store';

import type {
  AdminInvoiceListItem,
  CreateManualInvoiceDto,
  InvoiceSettlementResponse,
  IssueManualInvoiceDto,
  ManualInvoiceDetailResponse,
  MarkInvoicePaymentStatusDto,
  RecordInvoiceSettlementDto,
  UpdateManualInvoiceDto,
  VoidInvoiceDto,
} from '../../types/billing.types';

export const loadAdminInvoiceManager = createAction(
  '[AdminInvoiceManager] Load Invoices',
  props<{ search?: string; userId?: string; page?: number; pageSize?: number }>(),
);
export const loadAdminInvoiceManagerSuccess = createAction(
  '[AdminInvoiceManager] Load Invoices Success',
  props<{ invoices: AdminInvoiceListItem[]; total: number }>(),
);
export const loadAdminInvoiceManagerFailure = createAction(
  '[AdminInvoiceManager] Load Invoices Failure',
  props<{ error: string }>(),
);
export const createManualInvoice = createAction(
  '[AdminInvoiceManager] Create Manual Invoice',
  props<{ dto: CreateManualInvoiceDto }>(),
);
export const createManualInvoiceSuccess = createAction(
  '[AdminInvoiceManager] Create Manual Invoice Success',
  props<{ invoice: ManualInvoiceDetailResponse }>(),
);
export const createManualInvoiceFailure = createAction(
  '[AdminInvoiceManager] Create Manual Invoice Failure',
  props<{ error: string }>(),
);

export const updateManualInvoice = createAction(
  '[AdminInvoiceManager] Update Manual Invoice',
  props<{ invoiceRefId: string; dto: UpdateManualInvoiceDto }>(),
);
export const updateManualInvoiceSuccess = createAction(
  '[AdminInvoiceManager] Update Manual Invoice Success',
  props<{ invoice: ManualInvoiceDetailResponse }>(),
);
export const updateManualInvoiceFailure = createAction(
  '[AdminInvoiceManager] Update Manual Invoice Failure',
  props<{ error: string }>(),
);

export const issueManualInvoice = createAction(
  '[AdminInvoiceManager] Issue Manual Invoice',
  props<{ invoiceRefId: string; dto?: IssueManualInvoiceDto }>(),
);
export const issueManualInvoiceSuccess = createAction(
  '[AdminInvoiceManager] Issue Manual Invoice Success',
  props<{ invoice: ManualInvoiceDetailResponse }>(),
);
export const issueManualInvoiceFailure = createAction(
  '[AdminInvoiceManager] Issue Manual Invoice Failure',
  props<{ error: string }>(),
);

export const deleteManualInvoice = createAction(
  '[AdminInvoiceManager] Delete Manual Invoice',
  props<{ invoiceRefId: string }>(),
);
export const deleteManualInvoiceSuccess = createAction(
  '[AdminInvoiceManager] Delete Manual Invoice Success',
  props<{ invoiceRefId: string }>(),
);
export const deleteManualInvoiceFailure = createAction(
  '[AdminInvoiceManager] Delete Manual Invoice Failure',
  props<{ error: string }>(),
);

export const adminInvoiceManagerVoid = createAction(
  '[AdminInvoiceManager] Void Invoice',
  props<{ invoiceRefId: string; dto?: VoidInvoiceDto }>(),
);
export const adminInvoiceManagerVoidSuccess = createAction(
  '[AdminInvoiceManager] Void Invoice Success',
  props<{ invoice: AdminInvoiceListItem }>(),
);
export const adminInvoiceManagerVoidFailure = createAction(
  '[AdminInvoiceManager] Void Invoice Failure',
  props<{ error: string }>(),
);

export const adminInvoiceManagerMarkPaid = createAction(
  '[AdminInvoiceManager] Mark Paid',
  props<{ invoiceRefId: string; dto?: MarkInvoicePaymentStatusDto }>(),
);
export const adminInvoiceManagerMarkPaidSuccess = createAction(
  '[AdminInvoiceManager] Mark Paid Success',
  props<{ invoice: AdminInvoiceListItem }>(),
);
export const adminInvoiceManagerMarkPaidFailure = createAction(
  '[AdminInvoiceManager] Mark Paid Failure',
  props<{ error: string }>(),
);

export const adminInvoiceManagerMarkUnpaid = createAction(
  '[AdminInvoiceManager] Mark Unpaid',
  props<{ invoiceRefId: string; dto?: MarkInvoicePaymentStatusDto }>(),
);
export const adminInvoiceManagerMarkUnpaidSuccess = createAction(
  '[AdminInvoiceManager] Mark Unpaid Success',
  props<{ invoice: AdminInvoiceListItem }>(),
);
export const adminInvoiceManagerMarkUnpaidFailure = createAction(
  '[AdminInvoiceManager] Mark Unpaid Failure',
  props<{ error: string }>(),
);

export const adminInvoiceManagerWriteOff = createAction(
  '[AdminInvoiceManager] Write Off',
  props<{ invoiceRefId: string; dto?: RecordInvoiceSettlementDto }>(),
);
export const adminInvoiceManagerWriteOffSuccess = createAction(
  '[AdminInvoiceManager] Write Off Success',
  props<{ invoice: AdminInvoiceListItem }>(),
);
export const adminInvoiceManagerWriteOffFailure = createAction(
  '[AdminInvoiceManager] Write Off Failure',
  props<{ error: string }>(),
);

export const adminInvoiceManagerRefund = createAction(
  '[AdminInvoiceManager] Refund',
  props<{ invoiceRefId: string; dto?: RecordInvoiceSettlementDto }>(),
);
export const adminInvoiceManagerRefundSuccess = createAction(
  '[AdminInvoiceManager] Refund Success',
  props<{ invoice: AdminInvoiceListItem }>(),
);
export const adminInvoiceManagerRefundFailure = createAction(
  '[AdminInvoiceManager] Refund Failure',
  props<{ error: string }>(),
);

export const loadAdminInvoiceSettlements = createAction(
  '[AdminInvoiceManager] Load Settlements',
  props<{ invoiceRefId: string }>(),
);
export const loadAdminInvoiceSettlementsSuccess = createAction(
  '[AdminInvoiceManager] Load Settlements Success',
  props<{ invoiceRefId: string; settlements: InvoiceSettlementResponse[] }>(),
);
export const loadAdminInvoiceSettlementsFailure = createAction(
  '[AdminInvoiceManager] Load Settlements Failure',
  props<{ invoiceRefId: string; error: string }>(),
);
