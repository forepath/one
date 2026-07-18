import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import { InvoicesService } from '../../services/invoices.service';
import type {
  CreateInvoiceDto,
  InvoiceDetailResponse,
  InvoiceResponse,
  InvoicesSummaryResponse,
} from '../../types/billing.types';

import {
  clearInvoices,
  createInvoice,
  initiatePayment,
  loadInvoiceDetails,
  loadInvoices,
  loadInvoicesSummary as loadInvoicesSummaryAction,
  loadOpenOverdueInvoices,
} from './invoices.actions';
import {
  selectHasInvoicesBySubscriptionId,
  selectInvoiceDetailByRefId,
  selectInvoiceDetailsLoading,
  selectInvoicesBySubscriptionId,
  selectInvoicesCountBySubscriptionId,
  selectInvoicesCreating,
  selectInvoicesError,
  selectInvoicesLoading,
  selectInvoicesLoadingAny,
  selectInvoicesSummary,
  selectInvoicesSummaryError,
  selectInvoicesSummaryLoading,
  selectOpenOverdueList,
  selectOpenOverdueListError,
  selectOpenOverdueListLoading,
  selectPayingInvoiceRefId,
} from './invoices.selectors';

@Injectable({
  providedIn: 'root',
})
export class InvoicesFacade {
  private readonly store = inject(Store);
  private readonly invoicesService = inject(InvoicesService);

  getInvoicesBySubscriptionId$(subscriptionId: string): Observable<InvoiceResponse[]> {
    return this.store.select(selectInvoicesBySubscriptionId(subscriptionId));
  }

  getInvoicesLoading$(): Observable<boolean> {
    return this.store.select(selectInvoicesLoading);
  }

  getInvoicesCreating$(): Observable<boolean> {
    return this.store.select(selectInvoicesCreating);
  }

  getInvoicesLoadingAny$(): Observable<boolean> {
    return this.store.select(selectInvoicesLoadingAny);
  }

  getInvoicesError$(): Observable<string | null> {
    return this.store.select(selectInvoicesError);
  }

  getPayingInvoiceRefId$(): Observable<string | null> {
    return this.store.select(selectPayingInvoiceRefId);
  }

  getInvoiceDetailsLoading$(): Observable<boolean> {
    return this.store.select(selectInvoiceDetailsLoading);
  }

  getInvoiceDetail$(invoiceRefId: string): Observable<InvoiceDetailResponse | null> {
    return this.store.select(selectInvoiceDetailByRefId(invoiceRefId));
  }

  getInvoicesSummary$(): Observable<InvoicesSummaryResponse | null> {
    return this.store.select(selectInvoicesSummary);
  }

  getInvoicesSummaryLoading$(): Observable<boolean> {
    return this.store.select(selectInvoicesSummaryLoading);
  }

  getInvoicesSummaryError$(): Observable<string | null> {
    return this.store.select(selectInvoicesSummaryError);
  }

  loadInvoicesSummary(options?: { silent?: boolean }): void {
    this.store.dispatch(loadInvoicesSummaryAction(options?.silent === true));
  }

  getOpenOverdueList$(): Observable<InvoiceResponse[]> {
    return this.store.select(selectOpenOverdueList);
  }

  getOpenOverdueListLoading$(): Observable<boolean> {
    return this.store.select(selectOpenOverdueListLoading);
  }

  getOpenOverdueListError$(): Observable<string | null> {
    return this.store.select(selectOpenOverdueListError);
  }

  loadOpenOverdueInvoices(options?: { silent?: boolean }): void {
    this.store.dispatch(loadOpenOverdueInvoices(options?.silent === true));
  }

  getInvoicesCountBySubscriptionId$(subscriptionId: string): Observable<number> {
    return this.store.select(selectInvoicesCountBySubscriptionId(subscriptionId));
  }

  hasInvoicesBySubscriptionId$(subscriptionId: string): Observable<boolean> {
    return this.store.select(selectHasInvoicesBySubscriptionId(subscriptionId));
  }

  loadInvoices(subscriptionId: string, options?: { silent?: boolean }): void {
    this.store.dispatch(loadInvoices({ subscriptionId, silent: options?.silent === true }));
  }

  createInvoice(subscriptionId: string, dto?: CreateInvoiceDto): void {
    this.store.dispatch(createInvoice({ subscriptionId, dto }));
  }

  loadInvoiceDetails(subscriptionId: string | undefined, invoiceRefId: string, options?: { silent?: boolean }): void {
    this.store.dispatch(loadInvoiceDetails({ subscriptionId, invoiceRefId, silent: options?.silent === true }));
  }

  initiatePayment(subscriptionId: string | undefined, invoiceRefId: string): void {
    this.store.dispatch(initiatePayment({ subscriptionId, invoiceRefId }));
  }

  downloadInvoicePdf(subscriptionId: string | undefined, invoiceRefId: string): Observable<Blob> {
    return this.invoicesService.downloadInvoicePdf(subscriptionId, invoiceRefId);
  }

  downloadVoidDocumentPdf(subscriptionId: string | undefined, invoiceRefId: string): Observable<Blob> {
    return this.invoicesService.downloadVoidDocumentPdf(subscriptionId, invoiceRefId);
  }

  downloadTimeReportPdf(subscriptionId: string | undefined, invoiceRefId: string): Observable<Blob> {
    return this.invoicesService.downloadTimeReportPdf(subscriptionId, invoiceRefId);
  }

  voidInvoice(subscriptionId: string, invoiceRefId: string): Observable<InvoiceResponse> {
    return this.invoicesService.voidInvoice(subscriptionId, invoiceRefId);
  }

  clearInvoices(): void {
    this.store.dispatch(clearInvoices());
  }
}
