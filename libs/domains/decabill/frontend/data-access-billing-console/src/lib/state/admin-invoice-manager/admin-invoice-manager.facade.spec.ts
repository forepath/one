import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

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
import { AdminInvoiceManagerFacade } from './admin-invoice-manager.facade';

describe('AdminInvoiceManagerFacade', () => {
  let facade: AdminInvoiceManagerFacade;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AdminInvoiceManagerFacade, provideMockStore()],
    });
    facade = TestBed.inject(AdminInvoiceManagerFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('loadInvoices dispatches loadAdminInvoiceManager', () => {
    facade.loadInvoices();

    expect(store.dispatch).toHaveBeenCalledWith(loadAdminInvoiceManager());
  });

  it('createManualInvoice dispatches action', () => {
    const dto = {
      userId: 'user-1',
      lineItems: [{ description: 'Line', quantity: 1, unitPriceNet: 10, taxCategory: 'standard' as const }],
    };

    facade.createManualInvoice(dto);

    expect(store.dispatch).toHaveBeenCalledWith(createManualInvoice({ dto }));
  });

  it('updateManualInvoice dispatches action', () => {
    const dto = {
      lineItems: [{ description: 'Updated', quantity: 1, unitPriceNet: 20, taxCategory: 'standard' as const }],
    };

    facade.updateManualInvoice('inv-1', dto);

    expect(store.dispatch).toHaveBeenCalledWith(updateManualInvoice({ invoiceRefId: 'inv-1', dto }));
  });

  it('issueManualInvoice dispatches action', () => {
    facade.issueManualInvoice('inv-1', { dueInDays: 14 });

    expect(store.dispatch).toHaveBeenCalledWith(issueManualInvoice({ invoiceRefId: 'inv-1', dto: { dueInDays: 14 } }));
  });

  it('deleteManualInvoice dispatches action', () => {
    facade.deleteManualInvoice('inv-1');

    expect(store.dispatch).toHaveBeenCalledWith(deleteManualInvoice({ invoiceRefId: 'inv-1' }));
  });

  it('voidInvoice dispatches action', () => {
    facade.voidInvoice('inv-1');

    expect(store.dispatch).toHaveBeenCalledWith(adminInvoiceManagerVoid({ invoiceRefId: 'inv-1' }));
  });

  it('markPaid dispatches action', () => {
    facade.markPaid('inv-1', { reason: 'manual' });

    expect(store.dispatch).toHaveBeenCalledWith(
      adminInvoiceManagerMarkPaid({ invoiceRefId: 'inv-1', dto: { reason: 'manual' } }),
    );
  });

  it('markUnpaid dispatches action', () => {
    facade.markUnpaid('inv-1');

    expect(store.dispatch).toHaveBeenCalledWith(
      adminInvoiceManagerMarkUnpaid({ invoiceRefId: 'inv-1', dto: undefined }),
    );
  });
});
