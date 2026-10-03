import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type { PaginatedBillingAuditLogsResponse } from '../types/billing.types';
import type {
  AdminSupplierInvoiceListItem,
  AdminSupplierInvoicesListParams,
  IssueSupplierInvoiceDto,
  MarkSupplierInvoicePaymentStatusDto,
  PaginatedAdminSupplierInvoicesResponse,
  SupplierExpenseStatisticsParams,
  SupplierExpenseSummaryResponse,
  SupplierInvoiceDetailResponse,
  SupplierInvoiceParsePreviewResponse,
  UpdateSupplierInvoiceDto,
} from '../types/suppliers.types';

@Injectable({
  providedIn: 'root',
})
export class AdminSupplierInvoicesService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.urls.restApi;
  }

  list(params: AdminSupplierInvoicesListParams): Observable<PaginatedAdminSupplierInvoicesResponse> {
    let httpParams = new HttpParams();

    if (params.limit != null) httpParams = httpParams.set('limit', String(params.limit));

    if (params.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    if (params.search?.trim()) httpParams = httpParams.set('search', params.search.trim());

    if (params.status?.trim()) httpParams = httpParams.set('status', params.status.trim());

    return this.http.get<PaginatedAdminSupplierInvoicesResponse>(`${this.apiUrl}/admin/billing/supplier-invoices`, {
      params: httpParams,
    });
  }

  getSummary(params: SupplierExpenseStatisticsParams = {}): Observable<SupplierExpenseSummaryResponse> {
    let httpParams = new HttpParams();

    if (params.from) httpParams = httpParams.set('from', params.from);

    if (params.to) httpParams = httpParams.set('to', params.to);

    if (params.groupBy) httpParams = httpParams.set('groupBy', params.groupBy);

    if (params.supplierId) httpParams = httpParams.set('supplierId', params.supplierId);

    return this.http.get<SupplierExpenseSummaryResponse>(`${this.apiUrl}/admin/billing/supplier-invoices/statistics`, {
      params: httpParams,
    });
  }

  parseDocument(file: File): Observable<SupplierInvoiceParsePreviewResponse> {
    const formData = new FormData();

    formData.append('document', file);

    return this.http.post<SupplierInvoiceParsePreviewResponse>(
      `${this.apiUrl}/admin/billing/supplier-invoices/parse-document`,
      formData,
    );
  }

  create(formData: FormData): Observable<SupplierInvoiceDetailResponse> {
    return this.http.post<SupplierInvoiceDetailResponse>(`${this.apiUrl}/admin/billing/supplier-invoices`, formData);
  }

  getById(id: string): Observable<SupplierInvoiceDetailResponse> {
    return this.http.get<SupplierInvoiceDetailResponse>(`${this.apiUrl}/admin/billing/supplier-invoices/${id}`);
  }

  update(id: string, dto: UpdateSupplierInvoiceDto): Observable<SupplierInvoiceDetailResponse> {
    return this.http.post<SupplierInvoiceDetailResponse>(`${this.apiUrl}/admin/billing/supplier-invoices/${id}`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/admin/billing/supplier-invoices/${id}`);
  }

  issue(id: string, dto?: IssueSupplierInvoiceDto): Observable<SupplierInvoiceDetailResponse> {
    return this.http.post<SupplierInvoiceDetailResponse>(
      `${this.apiUrl}/admin/billing/supplier-invoices/${id}/issue`,
      dto ?? {},
    );
  }

  void(id: string): Observable<AdminSupplierInvoiceListItem> {
    return this.http.post<AdminSupplierInvoiceListItem>(
      `${this.apiUrl}/admin/billing/supplier-invoices/${id}/void`,
      {},
    );
  }

  markPaid(id: string, dto?: MarkSupplierInvoicePaymentStatusDto): Observable<AdminSupplierInvoiceListItem> {
    return this.http.post<AdminSupplierInvoiceListItem>(
      `${this.apiUrl}/admin/billing/supplier-invoices/${id}/mark-paid`,
      dto ?? {},
    );
  }

  markUnpaid(id: string, dto?: MarkSupplierInvoicePaymentStatusDto): Observable<AdminSupplierInvoiceListItem> {
    return this.http.post<AdminSupplierInvoiceListItem>(
      `${this.apiUrl}/admin/billing/supplier-invoices/${id}/mark-unpaid`,
      dto ?? {},
    );
  }

  downloadDocument(id: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/admin/billing/supplier-invoices/${id}/document`, {
      responseType: 'blob',
    });
  }

  listAuditLogs(id: string, limit = 20, offset = 0): Observable<PaginatedBillingAuditLogsResponse> {
    const params = new HttpParams().set('limit', String(limit)).set('offset', String(offset));

    return this.http.get<PaginatedBillingAuditLogsResponse>(
      `${this.apiUrl}/admin/billing/supplier-invoices/${id}/audit-logs`,
      { params },
    );
  }
}
