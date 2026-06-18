import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

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

  loadInvoices(): void {
    this.store.dispatch(loadAdminInvoiceManager());
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
