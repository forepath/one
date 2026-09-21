import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';

import { AdminOffersService } from '../../services/admin-offers.service';

import { loadAdminOffers, loadAdminOffersSuccess } from './admin-offers.actions';
import { loadAdminOffers$ } from './admin-offers.effects';

describe('adminOffers effects', () => {
  let actions$: Observable<unknown>;
  let service: { list: jest.Mock };

  beforeEach(() => {
    service = { list: jest.fn() };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AdminOffersService, useValue: service }],
    });
  });

  it('loads admin offers in one batch when total fits', (done) => {
    service.list.mockReturnValue(of({ items: [{ id: 'offer-1' }], total: 1, limit: 10, offset: 0 }));
    actions$ = of(loadAdminOffers({}));

    TestBed.runInInjectionContext(() => {
      loadAdminOffers$(actions$, service as never).subscribe((action) => {
        expect(action).toEqual(loadAdminOffersSuccess({ offers: [{ id: 'offer-1' }] }));
        done();
      });
    });
  });

  it('maps admin offer load errors', (done) => {
    service.list.mockReturnValue(throwError(() => new Error('load failed')));
    actions$ = of(loadAdminOffers({}));

    TestBed.runInInjectionContext(() => {
      loadAdminOffers$(actions$, service as never).subscribe((action) => {
        expect(action.type).toBe('[AdminOffers] Load Offers Failure');
        done();
      });
    });
  });
});
