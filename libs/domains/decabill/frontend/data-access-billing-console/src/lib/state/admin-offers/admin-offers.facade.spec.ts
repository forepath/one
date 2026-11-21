import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';

import { archiveAdminOffer, loadAdminOffers, revokeAdminOffer, sendAdminOffer } from './admin-offers.actions';
import { AdminOffersFacade } from './admin-offers.facade';

describe('AdminOffersFacade', () => {
  let facade: AdminOffersFacade;
  let store: jest.Mocked<Store>;

  beforeEach(() => {
    store = { select: jest.fn(), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [AdminOffersFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(AdminOffersFacade);
  });

  it('dispatches loadOffers', () => {
    facade.loadOffers({ search: 'abc' });
    expect(store.dispatch).toHaveBeenCalledWith(loadAdminOffers({ search: 'abc', userId: undefined }));
  });

  it('dispatches archiveOffer', () => {
    facade.archiveOffer('offer-1');
    expect(store.dispatch).toHaveBeenCalledWith(archiveAdminOffer({ id: 'offer-1' }));
  });

  it('dispatches archive / revoke with the notification choice, and send', () => {
    facade.archiveOffer('offer-1', { notifyCustomer: false, notifyOnExpiry: false });
    facade.sendOffer('offer-1');
    facade.revokeOffer('offer-1', { notifyCustomer: false });

    expect(store.dispatch).toHaveBeenCalledWith(
      archiveAdminOffer({ id: 'offer-1', dto: { notifyCustomer: false, notifyOnExpiry: false } }),
    );
    expect(store.dispatch).toHaveBeenCalledWith(sendAdminOffer({ id: 'offer-1' }));
    expect(store.dispatch).toHaveBeenCalledWith(revokeAdminOffer({ id: 'offer-1', dto: { notifyCustomer: false } }));
  });
});
