import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { loadAdminInvoiceManager } from './admin-invoice-manager.actions';
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
});
