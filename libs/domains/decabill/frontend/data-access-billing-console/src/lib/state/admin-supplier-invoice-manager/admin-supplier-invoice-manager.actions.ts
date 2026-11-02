import { createAction, props } from '@ngrx/store';

import type {
  AdminSupplierInvoiceListItem,
  IssueSupplierInvoiceDto,
  MarkSupplierInvoicePaymentStatusDto,
  SupplierExpenseStatisticsParams,
  SupplierExpenseSummaryResponse,
  SupplierInvoiceDetailResponse,
  SupplierInvoiceParsePreviewResponse,
  UpdateSupplierInvoiceDto,
} from '../../types/suppliers.types';

export const loadAdminSupplierInvoiceSummary = createAction(
  '[AdminSupplierInvoiceManager] Load Summary',
  props<{ params?: SupplierExpenseStatisticsParams }>(),
);
export const loadAdminSupplierInvoiceSummarySuccess = createAction(
  '[AdminSupplierInvoiceManager] Load Summary Success',
  props<{ summary: SupplierExpenseSummaryResponse }>(),
);
export const loadAdminSupplierInvoiceSummaryFailure = createAction(
  '[AdminSupplierInvoiceManager] Load Summary Failure',
  props<{ error: string }>(),
);

export const loadAdminSupplierInvoiceManager = createAction(
  '[AdminSupplierInvoiceManager] Load Invoices',
  props<{ search?: string; status?: string; page?: number; pageSize?: number }>(),
);
export const loadAdminSupplierInvoiceManagerSuccess = createAction(
  '[AdminSupplierInvoiceManager] Load Invoices Success',
  props<{ invoices: AdminSupplierInvoiceListItem[]; total: number }>(),
);
export const loadAdminSupplierInvoiceManagerFailure = createAction(
  '[AdminSupplierInvoiceManager] Load Invoices Failure',
  props<{ error: string }>(),
);
export const parseSupplierInvoiceDocument = createAction(
  '[AdminSupplierInvoiceManager] Parse Document',
  props<{ file: File }>(),
);
export const parseSupplierInvoiceDocumentSuccess = createAction(
  '[AdminSupplierInvoiceManager] Parse Document Success',
  props<{ preview: SupplierInvoiceParsePreviewResponse }>(),
);
export const parseSupplierInvoiceDocumentFailure = createAction(
  '[AdminSupplierInvoiceManager] Parse Document Failure',
  props<{ error: string }>(),
);

export const createSupplierInvoice = createAction(
  '[AdminSupplierInvoiceManager] Create Invoice',
  props<{ formData: FormData }>(),
);
export const createSupplierInvoiceSuccess = createAction(
  '[AdminSupplierInvoiceManager] Create Invoice Success',
  props<{ invoice: SupplierInvoiceDetailResponse }>(),
);
export const createSupplierInvoiceFailure = createAction(
  '[AdminSupplierInvoiceManager] Create Invoice Failure',
  props<{ error: string }>(),
);

export const updateSupplierInvoice = createAction(
  '[AdminSupplierInvoiceManager] Update Invoice',
  props<{ invoiceId: string; dto: UpdateSupplierInvoiceDto }>(),
);
export const updateSupplierInvoiceSuccess = createAction(
  '[AdminSupplierInvoiceManager] Update Invoice Success',
  props<{ invoice: SupplierInvoiceDetailResponse }>(),
);
export const updateSupplierInvoiceFailure = createAction(
  '[AdminSupplierInvoiceManager] Update Invoice Failure',
  props<{ error: string }>(),
);

export const issueSupplierInvoice = createAction(
  '[AdminSupplierInvoiceManager] Issue Invoice',
  props<{ invoiceId: string; dto?: IssueSupplierInvoiceDto }>(),
);
export const issueSupplierInvoiceSuccess = createAction(
  '[AdminSupplierInvoiceManager] Issue Invoice Success',
  props<{ invoice: SupplierInvoiceDetailResponse }>(),
);
export const issueSupplierInvoiceFailure = createAction(
  '[AdminSupplierInvoiceManager] Issue Invoice Failure',
  props<{ error: string }>(),
);

export const deleteSupplierInvoice = createAction(
  '[AdminSupplierInvoiceManager] Delete Invoice',
  props<{ invoiceId: string }>(),
);
export const deleteSupplierInvoiceSuccess = createAction(
  '[AdminSupplierInvoiceManager] Delete Invoice Success',
  props<{ invoiceId: string }>(),
);
export const deleteSupplierInvoiceFailure = createAction(
  '[AdminSupplierInvoiceManager] Delete Invoice Failure',
  props<{ error: string }>(),
);

export const adminSupplierInvoiceManagerVoid = createAction(
  '[AdminSupplierInvoiceManager] Void Invoice',
  props<{ invoiceId: string }>(),
);
export const adminSupplierInvoiceManagerVoidSuccess = createAction(
  '[AdminSupplierInvoiceManager] Void Invoice Success',
  props<{ invoice: AdminSupplierInvoiceListItem }>(),
);
export const adminSupplierInvoiceManagerVoidFailure = createAction(
  '[AdminSupplierInvoiceManager] Void Invoice Failure',
  props<{ error: string }>(),
);

export const adminSupplierInvoiceManagerMarkPaid = createAction(
  '[AdminSupplierInvoiceManager] Mark Paid',
  props<{ invoiceId: string; dto?: MarkSupplierInvoicePaymentStatusDto }>(),
);
export const adminSupplierInvoiceManagerMarkPaidSuccess = createAction(
  '[AdminSupplierInvoiceManager] Mark Paid Success',
  props<{ invoice: AdminSupplierInvoiceListItem }>(),
);
export const adminSupplierInvoiceManagerMarkPaidFailure = createAction(
  '[AdminSupplierInvoiceManager] Mark Paid Failure',
  props<{ error: string }>(),
);

export const adminSupplierInvoiceManagerMarkUnpaid = createAction(
  '[AdminSupplierInvoiceManager] Mark Unpaid',
  props<{ invoiceId: string; dto?: MarkSupplierInvoicePaymentStatusDto }>(),
);
export const adminSupplierInvoiceManagerMarkUnpaidSuccess = createAction(
  '[AdminSupplierInvoiceManager] Mark Unpaid Success',
  props<{ invoice: AdminSupplierInvoiceListItem }>(),
);
export const adminSupplierInvoiceManagerMarkUnpaidFailure = createAction(
  '[AdminSupplierInvoiceManager] Mark Unpaid Failure',
  props<{ error: string }>(),
);

export const clearSupplierInvoiceParsePreview = createAction('[AdminSupplierInvoiceManager] Clear Parse Preview');
