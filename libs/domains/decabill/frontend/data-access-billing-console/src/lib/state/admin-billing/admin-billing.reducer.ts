import { createReducer, on } from '@ngrx/store';

import type {
  AdminBillNowResponse,
  AdminBillingSummaryResponse,
  AdminInvoiceListItem,
  BillingAuditLogResponse,
  BillingStatisticsByCountry,
  BillingStatisticsByProduct,
  BillingStatisticsSummary,
} from '../../types/billing.types';

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
  loadAdminStatisticsByCountry,
  loadAdminStatisticsByCountryFailure,
  loadAdminStatisticsByCountrySuccess,
  loadAdminStatisticsByProduct,
  loadAdminStatisticsByProductFailure,
  loadAdminStatisticsByProductSuccess,
  loadAdminStatisticsSummary,
  loadAdminStatisticsSummaryFailure,
  loadAdminStatisticsSummarySuccess,
} from './admin-billing.actions';

export interface AdminBillingState {
  summary: AdminBillingSummaryResponse | null;
  summaryLoading: boolean;
  summaryError: string | null;
  billNowLoading: boolean;
  billNowResult: AdminBillNowResponse | null;
  billNowError: string | null;
  openOverdueItems: AdminInvoiceListItem[];
  openOverdueTotal: number;
  openOverdueLimit: number;
  openOverdueOffset: number;
  openOverdueLoading: boolean;
  openOverdueError: string | null;
  actionLoading: boolean;
  actionError: string | null;
  statisticsSummary: BillingStatisticsSummary | null;
  statisticsSummaryLoading: boolean;
  statisticsByProduct: BillingStatisticsByProduct | null;
  statisticsByProductLoading: boolean;
  statisticsByCountry: BillingStatisticsByCountry | null;
  statisticsByCountryLoading: boolean;
  statisticsError: string | null;
  auditLogsByInvoice: Record<string, BillingAuditLogResponse[]>;
  auditLogsTotalByInvoice: Record<string, number>;
  auditLogsLoading: boolean;
  auditLogsError: string | null;
}

export const initialAdminBillingState: AdminBillingState = {
  summary: null,
  summaryLoading: false,
  summaryError: null,
  billNowLoading: false,
  billNowResult: null,
  billNowError: null,
  openOverdueItems: [],
  openOverdueTotal: 0,
  openOverdueLimit: 10,
  openOverdueOffset: 0,
  openOverdueLoading: false,
  openOverdueError: null,
  actionLoading: false,
  actionError: null,
  statisticsSummary: null,
  statisticsSummaryLoading: false,
  statisticsByProduct: null,
  statisticsByProductLoading: false,
  statisticsByCountry: null,
  statisticsByCountryLoading: false,
  statisticsError: null,
  auditLogsByInvoice: {},
  auditLogsTotalByInvoice: {},
  auditLogsLoading: false,
  auditLogsError: null,
};

const OPEN_OVERDUE_STATUSES = new Set(['issued', 'partially_paid', 'overdue']);

function updateOpenOverdueList(items: AdminInvoiceListItem[], invoice: AdminInvoiceListItem): AdminInvoiceListItem[] {
  if (!invoice.status || !OPEN_OVERDUE_STATUSES.has(invoice.status)) {
    return items.filter((item) => item.id !== invoice.id);
  }

  const index = items.findIndex((item) => item.id === invoice.id);

  if (index < 0) return items;

  const next = [...items];

  next[index] = invoice;

  return next;
}

export const adminBillingReducer = createReducer(
  initialAdminBillingState,
  on(loadAdminBillingSummary, (state) => ({
    ...state,
    summaryLoading: true,
    summaryError: null,
  })),
  on(loadAdminBillingSummarySuccess, (state, { summary }) => ({
    ...state,
    summary,
    summaryLoading: false,
  })),
  on(loadAdminBillingSummaryFailure, (state, { error }) => ({
    ...state,
    summaryLoading: false,
    summaryError: error,
  })),
  on(billNow, (state) => ({
    ...state,
    billNowLoading: true,
    billNowError: null,
    billNowResult: null,
  })),
  on(billNowSuccess, (state, { result }) => ({
    ...state,
    billNowLoading: false,
    billNowResult: result,
  })),
  on(billNowFailure, (state, { error }) => ({
    ...state,
    billNowLoading: false,
    billNowError: error,
  })),
  on(loadAdminOpenOverdue, (state) => ({
    ...state,
    openOverdueLoading: true,
    openOverdueError: null,
  })),
  on(loadAdminOpenOverdueSuccess, (state, { items, total, limit, offset }) => ({
    ...state,
    openOverdueItems: items,
    openOverdueTotal: total,
    openOverdueLimit: limit,
    openOverdueOffset: offset,
    openOverdueLoading: false,
  })),
  on(loadAdminOpenOverdueFailure, (state, { error }) => ({
    ...state,
    openOverdueLoading: false,
    openOverdueError: error,
  })),
  on(adminVoidInvoice, adminMarkPaid, adminMarkUnpaid, (state) => ({
    ...state,
    actionLoading: true,
    actionError: null,
  })),
  on(adminVoidInvoiceSuccess, adminMarkPaidSuccess, adminMarkUnpaidSuccess, (state, { invoice }) => ({
    ...state,
    actionLoading: false,
    openOverdueItems: updateOpenOverdueList(state.openOverdueItems, invoice),
  })),
  on(adminVoidInvoiceFailure, adminMarkPaidFailure, adminMarkUnpaidFailure, (state, { error }) => ({
    ...state,
    actionLoading: false,
    actionError: error,
  })),
  on(loadAdminStatisticsSummary, (state) => ({
    ...state,
    statisticsSummaryLoading: true,
    statisticsError: null,
  })),
  on(loadAdminStatisticsSummarySuccess, (state, { summary }) => ({
    ...state,
    statisticsSummary: summary,
    statisticsSummaryLoading: false,
  })),
  on(loadAdminStatisticsSummaryFailure, (state, { error }) => ({
    ...state,
    statisticsSummaryLoading: false,
    statisticsError: error,
  })),
  on(loadAdminStatisticsByProduct, (state) => ({
    ...state,
    statisticsByProductLoading: true,
    statisticsError: null,
  })),
  on(loadAdminStatisticsByProductSuccess, (state, { byProduct }) => ({
    ...state,
    statisticsByProduct: byProduct,
    statisticsByProductLoading: false,
  })),
  on(loadAdminStatisticsByProductFailure, (state, { error }) => ({
    ...state,
    statisticsByProductLoading: false,
    statisticsError: error,
  })),
  on(loadAdminStatisticsByCountry, (state) => ({
    ...state,
    statisticsByCountryLoading: true,
    statisticsError: null,
  })),
  on(loadAdminStatisticsByCountrySuccess, (state, { byCountry }) => ({
    ...state,
    statisticsByCountry: byCountry,
    statisticsByCountryLoading: false,
  })),
  on(loadAdminStatisticsByCountryFailure, (state, { error }) => ({
    ...state,
    statisticsByCountryLoading: false,
    statisticsError: error,
  })),
  on(loadAdminAuditLogs, (state) => ({
    ...state,
    auditLogsLoading: true,
    auditLogsError: null,
  })),
  on(loadAdminAuditLogsSuccess, (state, { invoiceRefId, items, total }) => ({
    ...state,
    auditLogsLoading: false,
    auditLogsByInvoice: { ...state.auditLogsByInvoice, [invoiceRefId]: items },
    auditLogsTotalByInvoice: { ...state.auditLogsTotalByInvoice, [invoiceRefId]: total },
  })),
  on(loadAdminAuditLogsFailure, (state, { error }) => ({
    ...state,
    auditLogsLoading: false,
    auditLogsError: error,
  })),
);
