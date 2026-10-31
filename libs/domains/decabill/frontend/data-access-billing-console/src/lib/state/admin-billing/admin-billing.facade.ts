import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import { BILLING_LIST_PAGE_SIZE, billingPageWindow } from '../../constants/list-paging.constants';

import type {
  AdminBillNowDto,
  AdminBillingStatisticsParams,
  AdminOpenOverdueListParams,
  MarkInvoicePaymentStatusDto,
} from '../../types/billing.types';

import {
  adminMarkPaid,
  adminMarkUnpaid,
  adminVoidInvoice,
  billNow,
  loadAdminAuditLogs,
  loadAdminBillingSummary,
  loadAdminOpenOverdue,
  loadAdminStatisticsByCountry,
  loadAdminStatisticsByProduct,
  loadAdminStatisticsSummary,
} from './admin-billing.actions';
import {
  selectAdminActionError,
  selectAdminActionLoading,
  selectAdminAuditLogsByInvoice,
  selectAdminAuditLogsError,
  selectAdminAuditLogsLoading,
  selectAdminAuditLogsTotalByInvoice,
  selectAdminBillingSummary,
  selectAdminBillingSummaryError,
  selectAdminBillingSummaryLoading,
  selectAdminOpenOverdueError,
  selectAdminOpenOverdueItems,
  selectAdminOpenOverdueLoading,
  selectAdminOpenOverdueTotal,
  selectAdminStatisticsByCountry,
  selectAdminStatisticsByCountryLoading,
  selectAdminStatisticsByProduct,
  selectAdminStatisticsByProductLoading,
  selectAdminStatisticsError,
  selectAdminStatisticsSummary,
  selectAdminStatisticsSummaryLoading,
  selectBillNowError,
  selectBillNowLoading,
  selectBillNowResult,
} from './admin-billing.selectors';

@Injectable()
export class AdminBillingFacade {
  private readonly store = inject(Store);

  readonly summary$ = this.store.select(selectAdminBillingSummary);
  readonly summaryLoading$ = this.store.select(selectAdminBillingSummaryLoading);
  readonly summaryError$ = this.store.select(selectAdminBillingSummaryError);

  readonly billNowLoading$ = this.store.select(selectBillNowLoading);
  readonly billNowResult$ = this.store.select(selectBillNowResult);
  readonly billNowError$ = this.store.select(selectBillNowError);

  readonly openOverdueItems$ = this.store.select(selectAdminOpenOverdueItems);
  readonly openOverdueTotal$ = this.store.select(selectAdminOpenOverdueTotal);
  readonly openOverdueLoading$ = this.store.select(selectAdminOpenOverdueLoading);
  readonly openOverdueError$ = this.store.select(selectAdminOpenOverdueError);

  readonly actionLoading$ = this.store.select(selectAdminActionLoading);
  readonly actionError$ = this.store.select(selectAdminActionError);

  readonly statisticsSummary$ = this.store.select(selectAdminStatisticsSummary);
  readonly statisticsSummaryLoading$ = this.store.select(selectAdminStatisticsSummaryLoading);
  readonly statisticsByProduct$ = this.store.select(selectAdminStatisticsByProduct);
  readonly statisticsByProductLoading$ = this.store.select(selectAdminStatisticsByProductLoading);
  readonly statisticsByCountry$ = this.store.select(selectAdminStatisticsByCountry);
  readonly statisticsByCountryLoading$ = this.store.select(selectAdminStatisticsByCountryLoading);
  readonly statisticsError$ = this.store.select(selectAdminStatisticsError);

  readonly auditLogsByInvoice$ = this.store.select(selectAdminAuditLogsByInvoice);
  readonly auditLogsLoading$ = this.store.select(selectAdminAuditLogsLoading);
  readonly auditLogsTotalByInvoice$ = this.store.select(selectAdminAuditLogsTotalByInvoice);
  readonly auditLogsError$ = this.store.select(selectAdminAuditLogsError);

  loadSummary(): void {
    this.store.dispatch(loadAdminBillingSummary());
  }

  billNow(dto: AdminBillNowDto): void {
    this.store.dispatch(billNow({ dto }));
  }

  loadOpenOverdue(params: AdminOpenOverdueListParams): void {
    this.store.dispatch(loadAdminOpenOverdue({ params }));
  }

  voidInvoice(invoiceRefId: string): void {
    this.store.dispatch(adminVoidInvoice({ invoiceRefId }));
  }

  markPaid(invoiceRefId: string, dto?: MarkInvoicePaymentStatusDto): void {
    this.store.dispatch(adminMarkPaid({ invoiceRefId, dto }));
  }

  markUnpaid(invoiceRefId: string, dto?: MarkInvoicePaymentStatusDto): void {
    this.store.dispatch(adminMarkUnpaid({ invoiceRefId, dto }));
  }

  loadStatisticsSummary(params: AdminBillingStatisticsParams): void {
    this.store.dispatch(loadAdminStatisticsSummary({ params }));
  }

  loadStatisticsByProduct(params: AdminBillingStatisticsParams): void {
    this.store.dispatch(loadAdminStatisticsByProduct({ params }));
  }

  loadStatisticsByCountry(params: AdminBillingStatisticsParams): void {
    this.store.dispatch(loadAdminStatisticsByCountry({ params }));
  }

  /** One page of an invoice's audit log (replace-page; 1-based page, 25 by default). */
  loadAuditLogs(invoiceRefId: string, page = 1, pageSize = BILLING_LIST_PAGE_SIZE): void {
    const window = billingPageWindow(page, pageSize);

    this.store.dispatch(loadAdminAuditLogs({ invoiceRefId, limit: window.limit, offset: window.offset }));
  }
}
