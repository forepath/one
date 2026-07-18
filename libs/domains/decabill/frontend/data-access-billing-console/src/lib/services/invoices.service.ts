import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CreateInvoiceDto,
  CreateInvoiceResponse,
  InitiatePaymentResponse,
  InvoiceDetailResponse,
  InvoiceResponse,
  InvoicesSummaryResponse,
} from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class InvoicesService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  getInvoicesSummary(): Observable<InvoicesSummaryResponse> {
    return this.http.get<InvoicesSummaryResponse>(`${this.apiUrl}/invoices/summary`);
  }

  getOpenOverdueInvoices(): Observable<InvoiceResponse[]> {
    return this.http.get<InvoiceResponse[]>(`${this.apiUrl}/invoices/open-overdue`);
  }

  getHistoryInvoices(): Observable<InvoiceResponse[]> {
    return this.http.get<InvoiceResponse[]>(`${this.apiUrl}/invoices/history`);
  }

  listInvoices(subscriptionId: string): Observable<InvoiceResponse[]> {
    return this.http.get<InvoiceResponse[]>(`${this.apiUrl}/invoices/${subscriptionId}`);
  }

  getInvoiceDetails(subscriptionId: string | undefined, invoiceRefId: string): Observable<InvoiceDetailResponse> {
    const url = subscriptionId
      ? `${this.apiUrl}/invoices/${subscriptionId}/ref/${invoiceRefId}`
      : `${this.apiUrl}/invoices/ref/${invoiceRefId}`;

    return this.http.get<InvoiceDetailResponse>(url);
  }

  downloadInvoicePdf(subscriptionId: string | undefined, invoiceRefId: string): Observable<Blob> {
    const url = subscriptionId
      ? `${this.apiUrl}/invoices/${subscriptionId}/ref/${invoiceRefId}/pdf`
      : `${this.apiUrl}/invoices/ref/${invoiceRefId}/pdf`;

    return this.http.get(url, { responseType: 'blob' });
  }

  downloadVoidDocumentPdf(subscriptionId: string | undefined, invoiceRefId: string): Observable<Blob> {
    const url = subscriptionId
      ? `${this.apiUrl}/invoices/${subscriptionId}/ref/${invoiceRefId}/void-document/pdf`
      : `${this.apiUrl}/invoices/ref/${invoiceRefId}/void-document/pdf`;

    return this.http.get(url, { responseType: 'blob' });
  }

  downloadTimeReportPdf(subscriptionId: string | undefined, invoiceRefId: string): Observable<Blob> {
    const url = subscriptionId
      ? `${this.apiUrl}/invoices/${subscriptionId}/ref/${invoiceRefId}/time-report/pdf`
      : `${this.apiUrl}/invoices/ref/${invoiceRefId}/time-report/pdf`;

    return this.http.get(url, { responseType: 'blob' });
  }

  initiatePayment(subscriptionId: string | undefined, invoiceRefId: string): Observable<InitiatePaymentResponse> {
    const url = subscriptionId
      ? `${this.apiUrl}/invoices/${subscriptionId}/ref/${invoiceRefId}/pay`
      : `${this.apiUrl}/invoices/ref/${invoiceRefId}/pay`;

    return this.http.post<InitiatePaymentResponse>(url, {});
  }

  voidInvoice(subscriptionId: string, invoiceRefId: string): Observable<InvoiceResponse> {
    return this.http.post<InvoiceResponse>(`${this.apiUrl}/invoices/${subscriptionId}/ref/${invoiceRefId}/void`, {});
  }

  createInvoice(subscriptionId: string, dto?: CreateInvoiceDto): Observable<CreateInvoiceResponse> {
    return this.http.post<CreateInvoiceResponse>(`${this.apiUrl}/invoices/${subscriptionId}`, dto ?? {});
  }
}
