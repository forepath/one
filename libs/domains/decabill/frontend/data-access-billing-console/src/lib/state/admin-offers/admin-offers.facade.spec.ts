import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';

import { archiveAdminOffer, loadAdminOffers } from './admin-offers.actions';
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
});
