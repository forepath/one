import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs';

import type {
  IssueSupplierInvoiceDto,
  MarkSupplierInvoicePaymentStatusDto,
  SupplierExpenseStatisticsParams,
  UpdateSupplierInvoiceDto,
} from '../../types/suppliers.types';

import {
  adminSupplierInvoiceManagerMarkPaid,
  adminSupplierInvoiceManagerMarkUnpaid,
  adminSupplierInvoiceManagerVoid,
  clearSupplierInvoiceParsePreview,
  createSupplierInvoice,
  deleteSupplierInvoice,
  issueSupplierInvoice,
  loadAdminSupplierInvoiceManager,
  loadAdminSupplierInvoiceSummary,
  parseSupplierInvoiceDocument,
  updateSupplierInvoice,
} from './admin-supplier-invoice-manager.actions';
import {
  selectAdminSupplierInvoiceManagerActionLoading,
  selectAdminSupplierInvoiceManagerCreating,
  selectAdminSupplierInvoiceManagerDeleting,
  selectAdminSupplierInvoiceManagerError,
  selectAdminSupplierInvoiceManagerInvoices,
  selectAdminSupplierInvoiceManagerIssuing,
  selectAdminSupplierInvoiceManagerLoading,
  selectAdminSupplierInvoiceManagerParsing,
  selectAdminSupplierInvoiceManagerPage,
  selectAdminSupplierInvoiceManagerPageSize,
  selectAdminSupplierInvoiceManagerState,
  selectAdminSupplierInvoiceManagerTotal,
  selectAdminSupplierInvoiceManagerUpdating,
  selectAdminSupplierInvoiceParseError,
  selectAdminSupplierInvoiceParsePreview,
  selectAdminSupplierInvoiceSummary,
  selectAdminSupplierInvoiceSummaryError,
  selectAdminSupplierInvoiceSummaryLoading,
} from './admin-supplier-invoice-manager.selectors';

@Injectable()
export class AdminSupplierInvoiceManagerFacade {
  private readonly store = inject(Store);

  readonly summary$ = this.store.select(selectAdminSupplierInvoiceSummary);
  readonly summaryLoading$ = this.store.select(selectAdminSupplierInvoiceSummaryLoading);
  readonly summaryError$ = this.store.select(selectAdminSupplierInvoiceSummaryError);
  readonly invoices$ = this.store.select(selectAdminSupplierInvoiceManagerInvoices);
  readonly loading$ = this.store.select(selectAdminSupplierInvoiceManagerLoading);
  readonly creating$ = this.store.select(selectAdminSupplierInvoiceManagerCreating);
  readonly updating$ = this.store.select(selectAdminSupplierInvoiceManagerUpdating);
  readonly issuing$ = this.store.select(selectAdminSupplierInvoiceManagerIssuing);
  readonly deleting$ = this.store.select(selectAdminSupplierInvoiceManagerDeleting);
  readonly parsing$ = this.store.select(selectAdminSupplierInvoiceManagerParsing);
  readonly parsePreview$ = this.store.select(selectAdminSupplierInvoiceParsePreview);
  readonly parseError$ = this.store.select(selectAdminSupplierInvoiceParseError);
  readonly actionLoading$ = this.store.select(selectAdminSupplierInvoiceManagerActionLoading);
  readonly error$ = this.store.select(selectAdminSupplierInvoiceManagerError);
  readonly total$ = this.store.select(selectAdminSupplierInvoiceManagerTotal);
  readonly page$ = this.store.select(selectAdminSupplierInvoiceManagerPage);
  readonly pageSize$ = this.store.select(selectAdminSupplierInvoiceManagerPageSize);

  loadSummary(params?: SupplierExpenseStatisticsParams): void {
    this.store.dispatch(loadAdminSupplierInvoiceSummary({ params }));
  }

  /** Loads page 1 (or the given page) of the filtered list; the page replaces the current rows. */
  loadInvoices(params?: { search?: string; status?: string; page?: number; pageSize?: number }): void {
    this.store.dispatch(loadAdminSupplierInvoiceManager(params ?? {}));
  }

  /** Loads another page of the current filter (replace-page). */
  loadPage(page: number, pageSize?: number): void {
    this.store
      .select(selectAdminSupplierInvoiceManagerState)
      .pipe(take(1))
      .subscribe((state) =>
        this.store.dispatch(
          loadAdminSupplierInvoiceManager({
            search: state.search ?? undefined,
            status: state.status ?? undefined,
            page,
            pageSize: pageSize ?? state.pageSize,
          }),
        ),
      );
  }

  parseDocument(file: File): void {
    this.store.dispatch(parseSupplierInvoiceDocument({ file }));
  }

  clearParsePreview(): void {
    this.store.dispatch(clearSupplierInvoiceParsePreview());
  }

  createInvoice(formData: FormData): void {
    this.store.dispatch(createSupplierInvoice({ formData }));
  }

  updateInvoice(invoiceId: string, dto: UpdateSupplierInvoiceDto): void {
    this.store.dispatch(updateSupplierInvoice({ invoiceId, dto }));
  }

  issueInvoice(invoiceId: string, dto?: IssueSupplierInvoiceDto): void {
    this.store.dispatch(issueSupplierInvoice({ invoiceId, dto }));
  }

  deleteInvoice(invoiceId: string): void {
    this.store.dispatch(deleteSupplierInvoice({ invoiceId }));
  }

  voidInvoice(invoiceId: string): void {
    this.store.dispatch(adminSupplierInvoiceManagerVoid({ invoiceId }));
  }

  markPaid(invoiceId: string, dto?: MarkSupplierInvoicePaymentStatusDto): void {
    this.store.dispatch(adminSupplierInvoiceManagerMarkPaid({ invoiceId, dto }));
  }

  markUnpaid(invoiceId: string, dto?: MarkSupplierInvoicePaymentStatusDto): void {
    this.store.dispatch(adminSupplierInvoiceManagerMarkUnpaid({ invoiceId, dto }));
  }
}
