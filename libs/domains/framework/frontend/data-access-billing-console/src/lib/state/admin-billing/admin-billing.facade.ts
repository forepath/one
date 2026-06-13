import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

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
  loadAdminStatisticsByProduct,
  loadAdminStatisticsSummary,
} from './admin-billing.actions';
import {
  selectAdminActionError,
  selectAdminActionLoading,
  selectAdminAuditLogsByInvoice,
  selectAdminAuditLogsError,
  selectAdminAuditLogsLoading,
  selectAdminBillingSummary,
  selectAdminBillingSummaryError,
  selectAdminBillingSummaryLoading,
  selectAdminOpenOverdueError,
  selectAdminOpenOverdueItems,
  selectAdminOpenOverdueLoading,
  selectAdminOpenOverdueTotal,
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
  readonly statisticsError$ = this.store.select(selectAdminStatisticsError);

  readonly auditLogsByInvoice$ = this.store.select(selectAdminAuditLogsByInvoice);
  readonly auditLogsLoading$ = this.store.select(selectAdminAuditLogsLoading);
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

  loadAuditLogs(invoiceRefId: string, limit?: number, offset?: number): void {
    this.store.dispatch(loadAdminAuditLogs({ invoiceRefId, limit, offset }));
  }
}
