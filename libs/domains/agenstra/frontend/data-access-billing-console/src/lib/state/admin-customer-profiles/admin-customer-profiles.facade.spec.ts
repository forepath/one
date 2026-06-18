import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { loadAdminCustomerProfiles } from './admin-customer-profiles.actions';
import { AdminCustomerProfilesFacade } from './admin-customer-profiles.facade';

describe('AdminCustomerProfilesFacade', () => {
  let facade: AdminCustomerProfilesFacade;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AdminCustomerProfilesFacade, provideMockStore()],
    });
    facade = TestBed.inject(AdminCustomerProfilesFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('loadProfiles dispatches loadAdminCustomerProfiles', () => {
    facade.loadProfiles();

    expect(store.dispatch).toHaveBeenCalledWith(loadAdminCustomerProfiles());
  });
});
