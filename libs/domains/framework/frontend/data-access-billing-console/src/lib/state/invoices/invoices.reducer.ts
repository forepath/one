import { createReducer, on } from '@ngrx/store';

import type { InvoiceDetailResponse, InvoiceResponse, InvoicesSummaryResponse } from '../../types/billing.types';

import {
  clearInvoices,
  createInvoice,
  createInvoiceFailure,
  createInvoiceSuccess,
  initiatePayment,
  initiatePaymentFailure,
  initiatePaymentSuccess,
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

export interface InvoicesState {
  entities: Record<string, InvoiceResponse[]>;
  loading: boolean;
  creating: boolean;
  payingInvoiceRefId: string | null;
  invoiceDetails: Record<string, InvoiceDetailResponse>;
  detailsLoading: boolean;
  summary: InvoicesSummaryResponse | null;
  summaryLoading: boolean;
  summaryError: string | null;
  openOverdueList: InvoiceResponse[];
  openOverdueListLoading: boolean;
  openOverdueListError: string | null;
  error: string | null;
}

export const initialInvoicesState: InvoicesState = {
  entities: {},
  loading: false,
  creating: false,
  payingInvoiceRefId: null,
  invoiceDetails: {},
  detailsLoading: false,
  summary: null,
  summaryLoading: false,
  summaryError: null,
  openOverdueList: [],
  openOverdueListLoading: false,
  openOverdueListError: null,
  error: null,
};

export const invoicesReducer = createReducer(
  initialInvoicesState,
  on(loadInvoicesSummary, (state) => ({
    ...state,
    summaryLoading: true,
    summaryError: null,
  })),
  on(loadInvoicesSummarySuccess, (state, { summary }) => ({
    ...state,
    summary,
    summaryLoading: false,
    summaryError: null,
  })),
  on(loadInvoicesSummaryFailure, (state, { error }) => ({
    ...state,
    summaryLoading: false,
    summaryError: error,
  })),
  on(loadOpenOverdueInvoices, (state) => ({
    ...state,
    openOverdueListLoading: true,
    openOverdueListError: null,
  })),
  on(loadOpenOverdueInvoicesSuccess, (state, { invoices }) => ({
    ...state,
    openOverdueList: invoices,
    openOverdueListLoading: false,
    openOverdueListError: null,
  })),
  on(loadOpenOverdueInvoicesFailure, (state, { error }) => ({
    ...state,
    openOverdueListLoading: false,
    openOverdueListError: error,
  })),
  on(loadInvoices, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(loadInvoicesSuccess, (state, { subscriptionId, invoices }) => ({
    ...state,
    entities: { ...state.entities, [subscriptionId]: invoices },
    loading: false,
    error: null,
  })),
  on(loadInvoicesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(createInvoice, (state) => ({
    ...state,
    creating: true,
    error: null,
  })),
  on(createInvoiceSuccess, (state) => ({
    ...state,
    creating: false,
    error: null,
  })),
  on(createInvoiceFailure, (state, { error }) => ({
    ...state,
    creating: false,
    error,
  })),
  on(loadInvoiceDetails, (state) => ({
    ...state,
    detailsLoading: true,
    error: null,
  })),
  on(loadInvoiceDetailsSuccess, (state, { invoiceRefId, detail }) => ({
    ...state,
    invoiceDetails: { ...state.invoiceDetails, [invoiceRefId]: detail },
    detailsLoading: false,
    error: null,
  })),
  on(loadInvoiceDetailsFailure, (state, { error }) => ({
    ...state,
    detailsLoading: false,
    error,
  })),
  on(initiatePayment, (state, { invoiceRefId }) => ({
    ...state,
    payingInvoiceRefId: invoiceRefId,
    error: null,
  })),
  on(initiatePaymentSuccess, (state) => ({
    ...state,
    payingInvoiceRefId: null,
  })),
  on(initiatePaymentFailure, (state, { error }) => ({
    ...state,
    payingInvoiceRefId: null,
    error,
  })),
  on(clearInvoices, () => initialInvoicesState),
);
