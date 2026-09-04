import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import { OffersService } from '../../services/offers.service';

import { acceptOffer, loadHistoryOffers, loadOffersSummary, loadPendingOffers } from './offers.actions';
import { OffersFacade } from './offers.facade';

describe('OffersFacade', () => {
  let facade: OffersFacade;
  let store: jest.Mocked<Store>;
  let offersService: jest.Mocked<Pick<OffersService, 'downloadOfferPdf'>>;

  beforeEach(() => {
    store = { select: jest.fn(), dispatch: jest.fn() } as never;
    offersService = { downloadOfferPdf: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        OffersFacade,
        { provide: Store, useValue: store },
        { provide: OffersService, useValue: offersService },
      ],
    });

    facade = TestBed.inject(OffersFacade);
  });

  it('returns summary observable', (done) => {
    const summary = { pendingCount: 1, actionRequiredCount: 1, acceptedCount: 0, historyCount: 0 };

    store.select.mockReturnValue(of(summary));
    facade.getOffersSummary$().subscribe((result) => {
      expect(result).toEqual(summary);
      done();
    });
  });

  it('dispatches load actions', () => {
    facade.loadOffersSummary();
    facade.loadPendingOffers({ search: 'abc' });
    facade.loadHistoryOffers({ silent: true });

    expect(store.dispatch).toHaveBeenCalledWith(loadOffersSummary(false));
    expect(store.dispatch).toHaveBeenCalledWith(loadPendingOffers({ silent: false, search: 'abc' }));
    expect(store.dispatch).toHaveBeenCalledWith(loadHistoryOffers({ silent: true, search: undefined }));
  });

  it('dispatches acceptOffer', () => {
    facade.acceptOffer('offer-1');
    expect(store.dispatch).toHaveBeenCalledWith(acceptOffer({ offerId: 'offer-1' }));
  });

  it('delegates downloadOfferPdf to service', (done) => {
    const blob = new Blob(['pdf']);

    offersService.downloadOfferPdf.mockReturnValue(of(blob));
    facade.downloadOfferPdf('offer-1').subscribe((result) => {
      expect(result).toBe(blob);
      expect(offersService.downloadOfferPdf).toHaveBeenCalledWith('offer-1');
      done();
    });
  });
});
