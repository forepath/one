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

  it('loads one page of admin offers with the total (replace-page)', (done) => {
    service.list.mockReturnValue(of({ items: [{ id: 'offer-1' }], total: 26, limit: 25, offset: 25 }));
    actions$ = of(loadAdminOffers({ page: 2 }));

    TestBed.runInInjectionContext(() => {
      loadAdminOffers$(actions$, service as never).subscribe((action) => {
        expect(action).toEqual(loadAdminOffersSuccess({ offers: [{ id: 'offer-1' }] as never, total: 26 }));
        expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, offset: 25 }));
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
