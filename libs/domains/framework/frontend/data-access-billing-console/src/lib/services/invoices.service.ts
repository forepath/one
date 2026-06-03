import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/framework/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/framework/frontend/util-configuration';
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

  listInvoices(subscriptionId: string): Observable<InvoiceResponse[]> {
    return this.http.get<InvoiceResponse[]>(`${this.apiUrl}/invoices/${subscriptionId}`);
  }

  getInvoiceDetails(subscriptionId: string, invoiceRefId: string): Observable<InvoiceDetailResponse> {
    return this.http.get<InvoiceDetailResponse>(`${this.apiUrl}/invoices/${subscriptionId}/ref/${invoiceRefId}`);
  }

  downloadInvoicePdf(subscriptionId: string, invoiceRefId: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/invoices/${subscriptionId}/ref/${invoiceRefId}/pdf`, {
      responseType: 'blob',
    });
  }

  downloadVoidDocumentPdf(subscriptionId: string, invoiceRefId: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/invoices/${subscriptionId}/ref/${invoiceRefId}/void-document/pdf`, {
      responseType: 'blob',
    });
  }

  initiatePayment(subscriptionId: string, invoiceRefId: string): Observable<InitiatePaymentResponse> {
    return this.http.post<InitiatePaymentResponse>(
      `${this.apiUrl}/invoices/${subscriptionId}/ref/${invoiceRefId}/pay`,
      {},
    );
  }

  voidInvoice(subscriptionId: string, invoiceRefId: string): Observable<InvoiceResponse> {
    return this.http.post<InvoiceResponse>(`${this.apiUrl}/invoices/${subscriptionId}/ref/${invoiceRefId}/void`, {});
  }

  createInvoice(subscriptionId: string, dto?: CreateInvoiceDto): Observable<CreateInvoiceResponse> {
    return this.http.post<CreateInvoiceResponse>(`${this.apiUrl}/invoices/${subscriptionId}`, dto ?? {});
  }
}
