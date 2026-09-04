import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';

import { OffersService } from '../../services/offers.service';

import { loadPendingOffers, loadPendingOffersSuccess } from './offers.actions';
import { loadPendingOffers$ } from './offers.effects';

describe('offers effects', () => {
  let actions$: Observable<unknown>;
  let offersService: { getPendingOffers: jest.Mock };

  beforeEach(() => {
    offersService = { getPendingOffers: jest.fn() };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: OffersService, useValue: offersService }],
    });
  });

  it('loads pending offers', (done) => {
    offersService.getPendingOffers.mockReturnValue(of([]));
    actions$ = of(loadPendingOffers({}));

    TestBed.runInInjectionContext(() => {
      loadPendingOffers$(actions$, offersService as never).subscribe((action) => {
        expect(action).toEqual(loadPendingOffersSuccess({ offers: [] }));
        done();
      });
    });
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
