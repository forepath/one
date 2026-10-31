import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';

import { OffersService } from '../../services/offers.service';

import {
  acceptOfferSuccess,
  loadHistoryOffers,
  loadHistoryOffersSuccess,
  loadOffersSummary,
  loadPendingOffers,
  loadPendingOffersSuccess,
} from './offers.actions';
import { loadHistoryOffers$, loadPendingOffers$, reloadOffersAfterResponse$ } from './offers.effects';
import { initialOffersState } from './offers.reducer';

describe('offers effects', () => {
  let actions$: Observable<unknown>;
  let offersService: { getPendingOffers: jest.Mock; getHistoryOffers: jest.Mock };

  beforeEach(() => {
    offersService = { getPendingOffers: jest.fn(), getHistoryOffers: jest.fn() };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: OffersService, useValue: offersService }],
    });
  });

  it('loads page 1 of the pending offers with the total (replace-page)', (done) => {
    offersService.getPendingOffers.mockReturnValue(of({ items: [], total: 0, limit: 25, offset: 0 }));
    actions$ = of(loadPendingOffers({}));

    TestBed.runInInjectionContext(() => {
      loadPendingOffers$(actions$, offersService as never).subscribe((action) => {
        expect(action).toEqual(loadPendingOffersSuccess({ offers: [], total: 0 }));
        expect(offersService.getPendingOffers).toHaveBeenCalledWith({ search: undefined, limit: 25, offset: 0 });
        done();
      });
    });
  });

  it('loads the requested history page (limit / offset from page + size)', (done) => {
    offersService.getHistoryOffers.mockReturnValue(of({ items: [{ id: 'o-1' }], total: 51, limit: 50, offset: 50 }));
    actions$ = of(loadHistoryOffers({ search: 'acme', page: 2, pageSize: 50 }));

    TestBed.runInInjectionContext(() => {
      loadHistoryOffers$(actions$, offersService as never).subscribe((action) => {
        expect(action).toEqual(loadHistoryOffersSuccess({ offers: [{ id: 'o-1' }] as never, total: 51 }));
        expect(offersService.getHistoryOffers).toHaveBeenCalledWith({ search: 'acme', limit: 50, offset: 50 });
        done();
      });
    });
  });

  it('reloads the current pages (not page 1) after an accept / decline', () => {
    const store = {
      select: () =>
        of({ ...initialOffersState, pendingPage: 3, pendingSearch: 'x', historyPage: 2, historyPageSize: 50 }),
    };
    const emitted: unknown[] = [];

    reloadOffersAfterResponse$(
      of(acceptOfferSuccess({ offer: { id: 'o-1' } as never })) as never,
      store as never,
    ).subscribe((action) => emitted.push(action));

    expect(emitted).toEqual([
      loadOffersSummary(),
      loadPendingOffers({ search: 'x', page: 3, pageSize: 25 }),
      loadHistoryOffers({ search: undefined, page: 2, pageSize: 50 }),
    ]);
  });

  it('maps pending offer errors', (done) => {
    offersService.getPendingOffers.mockReturnValue(throwError(() => new Error('load failed')));
    actions$ = of(loadPendingOffers({}));

    TestBed.runInInjectionContext(() => {
      loadPendingOffers$(actions$, offersService as never).subscribe((action) => {
        expect(action.type).toBe('[Offers] Load Pending Offers Failure');
        done();
      });
    });
  });
});
