import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/framework/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/framework/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  AdminBillNowDto,
  AdminBillNowResponse,
  AdminBillingStatisticsParams,
  AdminBillingSummaryResponse,
  AdminOpenOverdueListParams,
  BillingStatisticsByProduct,
  BillingStatisticsSummary,
  MarkInvoicePaymentStatusDto,
  PaginatedAdminInvoicesResponse,
  PaginatedBillingAuditLogsResponse,
  AdminInvoiceListItem,
} from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class AdminBillingService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  getSummary(): Observable<AdminBillingSummaryResponse> {
    return this.http.get<AdminBillingSummaryResponse>(`${this.apiUrl}/admin/billing/summary`);
  }

  billNow(dto: AdminBillNowDto): Observable<AdminBillNowResponse> {
    return this.http.post<AdminBillNowResponse>(`${this.apiUrl}/admin/billing/bill-now`, dto);
  }

  listOpenOverdue(params: AdminOpenOverdueListParams): Observable<PaginatedAdminInvoicesResponse> {
    let httpParams = new HttpParams();

    if (params.limit != null) httpParams = httpParams.set('limit', String(params.limit));

    if (params.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    if (params.search) httpParams = httpParams.set('search', params.search);

    if (params.userId) httpParams = httpParams.set('userId', params.userId);

    return this.http.get<PaginatedAdminInvoicesResponse>(`${this.apiUrl}/admin/billing/invoices`, {
      params: httpParams,
    });
  }

  voidInvoice(invoiceRefId: string): Observable<AdminInvoiceListItem> {
    return this.http.post<AdminInvoiceListItem>(`${this.apiUrl}/admin/billing/invoices/${invoiceRefId}/void`, {});
  }

  markPaid(invoiceRefId: string, dto?: MarkInvoicePaymentStatusDto): Observable<AdminInvoiceListItem> {
    return this.http.post<AdminInvoiceListItem>(
      `${this.apiUrl}/admin/billing/invoices/${invoiceRefId}/mark-paid`,
      dto ?? {},
    );
  }

  markUnpaid(invoiceRefId: string, dto?: MarkInvoicePaymentStatusDto): Observable<AdminInvoiceListItem> {
    return this.http.post<AdminInvoiceListItem>(
      `${this.apiUrl}/admin/billing/invoices/${invoiceRefId}/mark-unpaid`,
      dto ?? {},
    );
  }

  listAuditLogs(invoiceRefId: string, limit = 20, offset = 0): Observable<PaginatedBillingAuditLogsResponse> {
    const params = new HttpParams().set('limit', String(limit)).set('offset', String(offset));

    return this.http.get<PaginatedBillingAuditLogsResponse>(
      `${this.apiUrl}/admin/billing/invoices/${invoiceRefId}/audit-logs`,
      { params },
    );
  }

  getStatisticsSummary(params: AdminBillingStatisticsParams): Observable<BillingStatisticsSummary> {
    let httpParams = new HttpParams();

    if (params.from) httpParams = httpParams.set('from', params.from);

    if (params.to) httpParams = httpParams.set('to', params.to);

    if (params.groupBy) httpParams = httpParams.set('groupBy', params.groupBy);

    if (params.userId) httpParams = httpParams.set('userId', params.userId);

    return this.http.get<BillingStatisticsSummary>(`${this.apiUrl}/admin/billing/statistics/summary`, {
      params: httpParams,
    });
  }

  getStatisticsByProduct(params: AdminBillingStatisticsParams): Observable<BillingStatisticsByProduct> {
    let httpParams = new HttpParams();

    if (params.from) httpParams = httpParams.set('from', params.from);

    if (params.to) httpParams = httpParams.set('to', params.to);

    if (params.userId) httpParams = httpParams.set('userId', params.userId);

    return this.http.get<BillingStatisticsByProduct>(`${this.apiUrl}/admin/billing/statistics/by-product`, {
      params: httpParams,
    });
  }
}
