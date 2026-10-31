import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs';

import type {
  CreateManualInvoiceDto,
  IssueManualInvoiceDto,
  MarkInvoicePaymentStatusDto,
  UpdateManualInvoiceDto,
} from '../../types/billing.types';

import {
  adminInvoiceManagerMarkPaid,
  adminInvoiceManagerMarkUnpaid,
  adminInvoiceManagerVoid,
  createManualInvoice,
  deleteManualInvoice,
  issueManualInvoice,
  loadAdminInvoiceManager,
  updateManualInvoice,
} from './admin-invoice-manager.actions';
import {
  selectAdminInvoiceManagerActionLoading,
  selectAdminInvoiceManagerCreating,
  selectAdminInvoiceManagerDeleting,
  selectAdminInvoiceManagerError,
  selectAdminInvoiceManagerInvoices,
  selectAdminInvoiceManagerIssuing,
  selectAdminInvoiceManagerLoading,
  selectAdminInvoiceManagerPage,
  selectAdminInvoiceManagerPageSize,
  selectAdminInvoiceManagerState,
  selectAdminInvoiceManagerTotal,
  selectAdminInvoiceManagerUpdating,
} from './admin-invoice-manager.selectors';

@Injectable()
export class AdminInvoiceManagerFacade {
  private readonly store = inject(Store);

  readonly invoices$ = this.store.select(selectAdminInvoiceManagerInvoices);
  readonly loading$ = this.store.select(selectAdminInvoiceManagerLoading);
  readonly creating$ = this.store.select(selectAdminInvoiceManagerCreating);
  readonly updating$ = this.store.select(selectAdminInvoiceManagerUpdating);
  readonly issuing$ = this.store.select(selectAdminInvoiceManagerIssuing);
  readonly deleting$ = this.store.select(selectAdminInvoiceManagerDeleting);
  readonly actionLoading$ = this.store.select(selectAdminInvoiceManagerActionLoading);
  readonly error$ = this.store.select(selectAdminInvoiceManagerError);
  readonly total$ = this.store.select(selectAdminInvoiceManagerTotal);
  readonly page$ = this.store.select(selectAdminInvoiceManagerPage);
  readonly pageSize$ = this.store.select(selectAdminInvoiceManagerPageSize);

  /** Loads page 1 (or the given page) of the filtered list; the page replaces the current rows. */
  loadInvoices(params?: { search?: string; userId?: string; page?: number; pageSize?: number }): void {
    this.store.dispatch(loadAdminInvoiceManager(params ?? {}));
  }

  /** Loads another page of the current filter (replace-page). */
  loadPage(page: number, pageSize?: number): void {
    this.store
      .select(selectAdminInvoiceManagerState)
      .pipe(take(1))
      .subscribe((state) =>
        this.store.dispatch(
          loadAdminInvoiceManager({
            search: state.search ?? undefined,
            userId: state.userId ?? undefined,
            page,
            pageSize: pageSize ?? state.pageSize,
          }),
        ),
      );
  }

  createManualInvoice(dto: CreateManualInvoiceDto): void {
    this.store.dispatch(createManualInvoice({ dto }));
  }

  updateManualInvoice(invoiceRefId: string, dto: UpdateManualInvoiceDto): void {
    this.store.dispatch(updateManualInvoice({ invoiceRefId, dto }));
  }

  issueManualInvoice(invoiceRefId: string, dto?: IssueManualInvoiceDto): void {
    this.store.dispatch(issueManualInvoice({ invoiceRefId, dto }));
  }

  deleteManualInvoice(invoiceRefId: string): void {
    this.store.dispatch(deleteManualInvoice({ invoiceRefId }));
  }

  voidInvoice(invoiceRefId: string): void {
    this.store.dispatch(adminInvoiceManagerVoid({ invoiceRefId }));
  }

  markPaid(invoiceRefId: string, dto?: MarkInvoicePaymentStatusDto): void {
    this.store.dispatch(adminInvoiceManagerMarkPaid({ invoiceRefId, dto }));
  }

  markUnpaid(invoiceRefId: string, dto?: MarkInvoicePaymentStatusDto): void {
    this.store.dispatch(adminInvoiceManagerMarkUnpaid({ invoiceRefId, dto }));
  }
}
