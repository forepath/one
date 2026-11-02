import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import {
  createAdminCustomerProfile,
  deleteAdminCustomerProfile,
  loadAdminCustomerProfiles,
  loadAdminCustomerProfileTrustScore,
  recomputeAdminCustomerProfileTrustScore,
  saveAdminCustomerProfileCustomData,
  updateAdminCustomerProfile,
} from './admin-customer-profiles.actions';
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

  it('loadProfiles requests the given page with the search', () => {
    facade.loadProfiles({ search: 'ada', page: 2, pageSize: 50 });

    expect(store.dispatch).toHaveBeenCalledWith(loadAdminCustomerProfiles({ search: 'ada', page: 2, pageSize: 50 }));
  });

  it('createProfile dispatches createAdminCustomerProfile', () => {
    const dto = { userId: 'u-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' };

    facade.createProfile(dto);

    expect(store.dispatch).toHaveBeenCalledWith(createAdminCustomerProfile({ dto }));
  });

  it('updateProfile dispatches updateAdminCustomerProfile', () => {
    const dto = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', country: 'DE' };

    facade.updateProfile('p-1', dto);

    expect(store.dispatch).toHaveBeenCalledWith(updateAdminCustomerProfile({ id: 'p-1', dto }));
  });

  it('deleteProfile dispatches deleteAdminCustomerProfile', () => {
    facade.deleteProfile('p-1');

    expect(store.dispatch).toHaveBeenCalledWith(deleteAdminCustomerProfile({ id: 'p-1' }));
  });

  it('loadTrustScore dispatches loadAdminCustomerProfileTrustScore', () => {
    facade.loadTrustScore('p-1');

    expect(store.dispatch).toHaveBeenCalledWith(loadAdminCustomerProfileTrustScore({ id: 'p-1' }));
  });

  it('recomputeTrustScore dispatches recomputeAdminCustomerProfileTrustScore', () => {
    facade.recomputeTrustScore('p-1');

    expect(store.dispatch).toHaveBeenCalledWith(recomputeAdminCustomerProfileTrustScore({ id: 'p-1' }));
  });

  it('saveCustomData dispatches saveAdminCustomerProfileCustomData', () => {
    facade.saveCustomData('p-1', { a: '1' }, { a: '2' });

    expect(store.dispatch).toHaveBeenCalledWith(
      saveAdminCustomerProfileCustomData({ id: 'p-1', original: { a: '1' }, next: { a: '2' } }),
    );
  });
});
