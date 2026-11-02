import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';

import { AdminPromotionsService } from '../../services/admin-promotions.service';

import {
  loadAdminPromotionRedemptions,
  loadAdminPromotionRedemptionsSuccess,
  loadAdminPromotions,
  loadAdminPromotionsSuccess,
} from './admin-promotions.actions';
import { loadAdminPromotionRedemptions$, loadAdminPromotions$ } from './admin-promotions.effects';

describe('adminPromotions effects', () => {
  let actions$: Observable<unknown>;
  let service: { list: jest.Mock; listRedemptions: jest.Mock };

  beforeEach(() => {
    service = { list: jest.fn(), listRedemptions: jest.fn() };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AdminPromotionsService, useValue: service }],
    });
  });

  it('loads one page of promotions with the total in a single request (replace-page)', (done) => {
    service.list.mockReturnValue(of({ items: [{ id: 'p-26' }], total: 26, limit: 25, offset: 25 }));
    actions$ = of(loadAdminPromotions({ search: 'save', page: 2 }));

    TestBed.runInInjectionContext(() => {
      loadAdminPromotions$(actions$, service as never).subscribe((action) => {
        expect(action).toEqual(loadAdminPromotionsSuccess({ promotions: [{ id: 'p-26' }] as never, total: 26 }));
        expect(service.list).toHaveBeenCalledTimes(1);
        expect(service.list).toHaveBeenCalledWith({ limit: 25, offset: 25, search: 'save' });
        done();
      });
    });
  });

  it('maps promotion load errors', (done) => {
    service.list.mockReturnValue(throwError(() => new Error('load failed')));
    actions$ = of(loadAdminPromotions({}));

    TestBed.runInInjectionContext(() => {
      loadAdminPromotions$(actions$, service as never).subscribe((action) => {
        expect(action).toEqual(expect.objectContaining({ type: '[AdminPromotions] Load Promotions Failure' }));
        done();
      });
    });
  });

  it("loads one page of a promotion's redemptions with the total", (done) => {
    service.listRedemptions.mockReturnValue(of({ items: [{ id: 'r1' }], total: 51, limit: 50, offset: 50 }));
    actions$ = of(loadAdminPromotionRedemptions({ promotionId: 'promo-1', page: 2, pageSize: 50 }));

    TestBed.runInInjectionContext(() => {
      loadAdminPromotionRedemptions$(actions$, service as never).subscribe((action) => {
        expect(action).toEqual(
          loadAdminPromotionRedemptionsSuccess({ redemptions: [{ id: 'r1' }] as never, total: 51 }),
        );
        expect(service.listRedemptions).toHaveBeenCalledWith('promo-1', { limit: 50, offset: 50 });
        done();
      });
    });
  });
});
