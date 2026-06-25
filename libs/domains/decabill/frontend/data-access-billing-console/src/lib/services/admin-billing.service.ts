import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  AdminBillNowDto,
  AdminBillNowResponse,
  AdminBillingStatisticsParams,
  AdminBillingSummaryResponse,
  AdminOpenOverdueListParams,
  BillingStatisticsByProduct,
  BillingStatisticsSummary,
  CreateManualInvoiceDto,
  IssueManualInvoiceDto,
  ManualInvoiceDetailResponse,
  MarkInvoicePaymentStatusDto,
  PaginatedAdminInvoicesResponse,
  PaginatedBillingAuditLogsResponse,
  AdminInvoiceListItem,
  SubscriptionResponse,
  UpdateManualInvoiceDto,
} from '../types/billing.types';
import type {
  AdminDatevExportListParams,
  BillingCapabilitiesResponse,
  PaginatedAdminDatevExportsResponse,
  TriggerDatevExportDto,
  TriggerDatevExportResponse,
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

  listInvoices(params: AdminOpenOverdueListParams): Observable<PaginatedAdminInvoicesResponse> {
    return this.listOpenOverdue(params);
  }

  listUserSubscriptions(
    userId: string,
    params?: { limit?: number; offset?: number },
  ): Observable<SubscriptionResponse[]> {
    let httpParams = new HttpParams();

    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));

    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    return this.http.get<SubscriptionResponse[]>(`${this.apiUrl}/admin/billing/users/${userId}/subscriptions`, {
      params: httpParams,
    });
  }

  createManualInvoice(dto: CreateManualInvoiceDto): Observable<ManualInvoiceDetailResponse> {
    return this.http.post<ManualInvoiceDetailResponse>(`${this.apiUrl}/admin/billing/invoices/manual`, dto);
  }

  getManualInvoiceDetail(invoiceRefId: string): Observable<ManualInvoiceDetailResponse> {
    return this.http.get<ManualInvoiceDetailResponse>(`${this.apiUrl}/admin/billing/invoices/${invoiceRefId}`);
  }

  updateManualInvoice(invoiceRefId: string, dto: UpdateManualInvoiceDto): Observable<ManualInvoiceDetailResponse> {
    return this.http.post<ManualInvoiceDetailResponse>(`${this.apiUrl}/admin/billing/invoices/${invoiceRefId}`, dto);
  }

  issueManualInvoice(invoiceRefId: string, dto?: IssueManualInvoiceDto): Observable<ManualInvoiceDetailResponse> {
    return this.http.post<ManualInvoiceDetailResponse>(
      `${this.apiUrl}/admin/billing/invoices/${invoiceRefId}/issue`,
      dto ?? {},
    );
  }

  deleteManualInvoice(invoiceRefId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/admin/billing/invoices/${invoiceRefId}`);
  }

  downloadInvoicePdf(invoiceRefId: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/admin/billing/invoices/${invoiceRefId}/pdf`, {
      responseType: 'blob',
    });
  }

  downloadVoidDocumentPdf(invoiceRefId: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/admin/billing/invoices/${invoiceRefId}/void-document/pdf`, {
      responseType: 'blob',
    });
  }

  getCapabilities(): Observable<BillingCapabilitiesResponse> {
    return this.http.get<BillingCapabilitiesResponse>(`${this.apiUrl}/admin/billing/capabilities`);
  }

  listDatevExports(params: AdminDatevExportListParams): Observable<PaginatedAdminDatevExportsResponse> {
    let httpParams = new HttpParams();

    if (params.limit != null) httpParams = httpParams.set('limit', String(params.limit));

    if (params.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    if (params.year != null) httpParams = httpParams.set('year', String(params.year));

    if (params.scope) httpParams = httpParams.set('scope', params.scope);

    return this.http.get<PaginatedAdminDatevExportsResponse>(`${this.apiUrl}/admin/billing/datev-exports`, {
      params: httpParams,
    });
  }

  triggerDatevExport(dto: TriggerDatevExportDto): Observable<TriggerDatevExportResponse> {
    return this.http.post<TriggerDatevExportResponse>(`${this.apiUrl}/admin/billing/datev-exports`, dto);
  }

  downloadDatevExport(exportId: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/admin/billing/datev-exports/${exportId}/download`, {
      responseType: 'blob',
    });
  }
}
