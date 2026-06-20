import { createReducer, on } from '@ngrx/store';

import type { AdminInvoiceListItem } from '../../types/billing.types';

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

export interface AdminInvoiceManagerState {
  invoices: AdminInvoiceListItem[];
  loading: boolean;
  creating: boolean;
  updating: boolean;
  issuing: boolean;
  deleting: boolean;
  actionLoading: boolean;
  error: string | null;
}

export const initialAdminInvoiceManagerState: AdminInvoiceManagerState = {
  invoices: [],
  loading: false,
  creating: false,
  updating: false,
  issuing: false,
  deleting: false,
  actionLoading: false,
  error: null,
};

function upsertInvoice(invoices: AdminInvoiceListItem[], invoice: AdminInvoiceListItem): AdminInvoiceListItem[] {
  const index = invoices.findIndex((item) => item.id === invoice.id);

  if (index === -1) {
    return [invoice, ...invoices];
  }

  const next = [...invoices];

  next[index] = invoice;

  return next;
}

function mapDetailToListItem(invoice: {
  id: string;
  subscriptionId?: string;
  invoiceNumber?: string | null;
  status?: string;
  balanceDue?: number;
  createdAt: string;
  dueDate?: string | null;
  userId: string;
  userEmail?: string;
  canPay?: boolean;
  canDownload?: boolean;
  canPreview?: boolean;
  canDownloadVoidDocument?: boolean;
  voidDocumentNumber?: string | null;
}): AdminInvoiceListItem {
  return {
    id: invoice.id,
    subscriptionId: invoice.subscriptionId,
    invoiceNumber: invoice.invoiceNumber ?? undefined,
    status: invoice.status,
    balance: invoice.balanceDue,
    createdAt: invoice.createdAt,
    dueDate: invoice.dueDate ?? undefined,
    userId: invoice.userId,
    userEmail: invoice.userEmail,
    canPay: invoice.canPay ?? false,
    canDownload: invoice.canDownload ?? false,
    canPreview: invoice.canPreview ?? false,
    canDownloadVoidDocument: invoice.canDownloadVoidDocument,
    voidDocumentNumber: invoice.voidDocumentNumber ?? undefined,
  };
}

export const adminInvoiceManagerReducer = createReducer(
  initialAdminInvoiceManagerState,
  on(loadAdminInvoiceManager, (state) => ({
    ...state,
    invoices: [],
    loading: true,
    error: null,
  })),
  on(loadAdminInvoiceManagerBatch, (state, { accumulatedInvoices }) => ({
    ...state,
    invoices: accumulatedInvoices,
    loading: true,
  })),
  on(loadAdminInvoiceManagerSuccess, (state, { invoices }) => ({
    ...state,
    invoices,
    loading: false,
    error: null,
  })),
  on(loadAdminInvoiceManagerFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(createManualInvoice, (state) => ({ ...state, creating: true, error: null })),
  on(createManualInvoiceSuccess, (state, { invoice }) => ({
    ...state,
    creating: false,
    invoices: upsertInvoice(state.invoices, mapDetailToListItem(invoice)),
  })),
  on(createManualInvoiceFailure, (state, { error }) => ({ ...state, creating: false, error })),
  on(updateManualInvoice, (state) => ({ ...state, updating: true, error: null })),
  on(updateManualInvoiceSuccess, (state, { invoice }) => ({
    ...state,
    updating: false,
    invoices: upsertInvoice(state.invoices, mapDetailToListItem(invoice)),
  })),
  on(updateManualInvoiceFailure, (state, { error }) => ({ ...state, updating: false, error })),
  on(issueManualInvoice, (state) => ({ ...state, issuing: true, error: null })),
  on(issueManualInvoiceSuccess, (state, { invoice }) => ({
    ...state,
    issuing: false,
    invoices: upsertInvoice(state.invoices, mapDetailToListItem(invoice)),
  })),
  on(issueManualInvoiceFailure, (state, { error }) => ({ ...state, issuing: false, error })),
  on(deleteManualInvoice, (state) => ({ ...state, deleting: true, error: null })),
  on(deleteManualInvoiceSuccess, (state, { invoiceRefId }) => ({
    ...state,
    deleting: false,
    invoices: state.invoices.filter((invoice) => invoice.id !== invoiceRefId),
  })),
  on(deleteManualInvoiceFailure, (state, { error }) => ({ ...state, deleting: false, error })),
  on(adminInvoiceManagerVoid, adminInvoiceManagerMarkPaid, adminInvoiceManagerMarkUnpaid, (state) => ({
    ...state,
    actionLoading: true,
    error: null,
  })),
  on(
    adminInvoiceManagerVoidSuccess,
    adminInvoiceManagerMarkPaidSuccess,
    adminInvoiceManagerMarkUnpaidSuccess,
    (state, { invoice }) => ({
      ...state,
      actionLoading: false,
      invoices: upsertInvoice(state.invoices, invoice),
    }),
  ),
  on(
    adminInvoiceManagerVoidFailure,
    adminInvoiceManagerMarkPaidFailure,
    adminInvoiceManagerMarkUnpaidFailure,
    (state, { error }) => ({ ...state, actionLoading: false, error }),
  ),
);
