import { createReducer, on } from '@ngrx/store';

import { BILLING_LIST_PAGE_SIZE, billingPageWindow } from '../../constants/list-paging.constants';

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
  loadHistoryInvoices,
  loadHistoryInvoicesFailure,
  loadHistoryInvoicesSuccess,
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
  historyList: InvoiceResponse[];
  historyListLoading: boolean;
  historyListError: string | null;
  openOverdueSearch: string | null;
  historySearch: string | null;
  /** Replace-page paging of both lists (array API → `hasMore` from one extra row; 1-based page and its size). */
  openOverdueHasMore: boolean;
  openOverduePage: number;
  openOverduePageSize: number;
  historyHasMore: boolean;
  historyPage: number;
  historyPageSize: number;
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
  historyList: [],
  historyListLoading: false,
  historyListError: null,
  openOverdueSearch: null,
  historySearch: null,
  openOverdueHasMore: false,
  openOverduePage: 1,
  openOverduePageSize: BILLING_LIST_PAGE_SIZE,
  historyHasMore: false,
  historyPage: 1,
  historyPageSize: BILLING_LIST_PAGE_SIZE,
  error: null,
};

export const invoicesReducer = createReducer(
  initialInvoicesState,
  on(loadInvoicesSummary, (state, { silent }) =>
    silent
      ? state
      : {
          ...state,
          summaryLoading: true,
          summaryError: null,
        },
  ),
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
  on(loadOpenOverdueInvoices, (state, { silent, search, page, pageSize }) => {
    const window = billingPageWindow(page, pageSize ?? state.openOverduePageSize);
    const query = {
      openOverduePage: window.page,
      openOverduePageSize: window.pageSize,
      openOverdueSearch: search?.trim() ? search.trim() : null,
    };

    return silent
      ? { ...state, ...query }
      : { ...state, ...query, openOverdueListLoading: true, openOverdueListError: null };
  }),
  on(loadOpenOverdueInvoicesSuccess, (state, { invoices, hasMore }) => ({
    ...state,
    openOverdueList: invoices,
    openOverdueHasMore: hasMore,
    openOverdueListLoading: false,
    openOverdueListError: null,
  })),
  on(loadOpenOverdueInvoicesFailure, (state, { error }) => ({
    ...state,
    openOverdueListLoading: false,
    openOverdueListError: error,
  })),
  on(loadHistoryInvoices, (state, { silent, search, page, pageSize }) => {
    const window = billingPageWindow(page, pageSize ?? state.historyPageSize);
    const query = {
      historyPage: window.page,
      historyPageSize: window.pageSize,
      historySearch: search?.trim() ? search.trim() : null,
    };

    return silent ? { ...state, ...query } : { ...state, ...query, historyListLoading: true, historyListError: null };
  }),
  on(loadHistoryInvoicesSuccess, (state, { invoices, hasMore }) => ({
    ...state,
    historyList: invoices,
    historyHasMore: hasMore,
    historyListLoading: false,
    historyListError: null,
  })),
  on(loadHistoryInvoicesFailure, (state, { error }) => ({
    ...state,
    historyListLoading: false,
    historyListError: error,
  })),
  on(loadInvoices, (state, { silent }) =>
    silent
      ? state
      : {
          ...state,
          loading: true,
          error: null,
        },
  ),
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
  on(loadInvoiceDetails, (state, { silent }) =>
    silent
      ? state
      : {
          ...state,
          detailsLoading: true,
          error: null,
        },
  ),
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
