import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Actions } from '@ngrx/effects';
import { of, throwError } from 'rxjs';

import { PromotionsService } from '../../services/promotions.service';

import {
  loadActivePromotions,
  loadActivePromotionsBatch,
  loadActivePromotionsFailure,
  loadActivePromotionsSuccess,
  loadPromotionRedemptions,
  loadPromotionRedemptionsSuccess,
  redeemPromotion,
  redeemPromotionFailure,
  redeemPromotionSuccess,
  validatePromotion,
  validatePromotionFailure,
  validatePromotionSuccess,
} from './promotions.actions';
import {
  loadActivePromotions$,
  loadActivePromotionsBatch$,
  loadPromotionRedemptions$,
  redeemPromotion$,
  validatePromotion$,
} from './promotions.effects';

describe('PromotionsEffects', () => {
  let actions$: Actions;
  let promotionsService: jest.Mocked<PromotionsService>;

  beforeEach(() => {
    promotionsService = {
      listActive: jest.fn(),
      listRedemptions: jest.fn(),
      validate: jest.fn(),
      redeem: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: PromotionsService, useValue: promotionsService }],
    });
  });

  it('loads active promotions in one batch when response is short', (done) => {
    actions$ = of(loadActivePromotions());
    promotionsService.listActive.mockReturnValue(
      of({ items: [{ id: 'r-1' } as never], total: 1, limit: 10, offset: 0 }),
    );

    loadActivePromotions$(actions$, promotionsService).subscribe((result) => {
      expect(result).toEqual(loadActivePromotionsSuccess({ items: [{ id: 'r-1' } as never] }));
      done();
    });
  });

  it('continues active promotion batching when first page is full', (done) => {
    const firstPage = Array.from({ length: 10 }, (_, index) => ({ id: `r-${index}` }));
    actions$ = of(loadActivePromotions());
    promotionsService.listActive.mockReturnValue(of({ items: firstPage as never[], total: 20, limit: 10, offset: 0 }));

    loadActivePromotions$(actions$, promotionsService).subscribe((result) => {
      expect(result).toEqual(loadActivePromotionsBatch({ offset: 10, accumulated: firstPage }));
      done();
    });
  });

  it('completes active promotion batching', (done) => {
    const accumulated = [{ id: 'r-1' }];
    actions$ = of(loadActivePromotionsBatch({ offset: 10, accumulated: accumulated as never[] }));
    promotionsService.listActive.mockReturnValue(
      of({ items: [{ id: 'r-2' } as never], total: 2, limit: 10, offset: 10 }),
    );

    loadActivePromotionsBatch$(actions$, promotionsService).subscribe((result) => {
      expect(result).toEqual(loadActivePromotionsSuccess({ items: [{ id: 'r-1' }, { id: 'r-2' }] as never[] }));
      done();
    });
  });

  it('loads promotion redemptions', (done) => {
    actions$ = of(loadPromotionRedemptions());
    promotionsService.listRedemptions.mockReturnValue(
      of({ items: [{ id: 'r-1' } as never], total: 1, limit: 10, offset: 0 }),
    );

    loadPromotionRedemptions$(actions$, promotionsService).subscribe((result) => {
      expect(result).toEqual(loadPromotionRedemptionsSuccess({ items: [{ id: 'r-1' } as never] }));
      done();
    });
  });

  it('validates promotion codes', (done) => {
    const request = { code: 'SAVE10', redemptionContext: 'new' as const, planId: 'plan-1' };
    const preview = { valid: true, code: 'SAVE10' };
    actions$ = of(validatePromotion({ request }));
    promotionsService.validate.mockReturnValue(of(preview));

    validatePromotion$(actions$, promotionsService).subscribe((result) => {
      expect(result).toEqual(validatePromotionSuccess({ request, preview }));
      done();
    });
  });

  it('maps validate failures', (done) => {
    const request = { code: 'BAD', redemptionContext: 'new' as const, planId: 'plan-1' };
    actions$ = of(validatePromotion({ request }));
    promotionsService.validate.mockReturnValue(throwError(() => new Error('Invalid code')));

    validatePromotion$(actions$, promotionsService).subscribe((result) => {
      expect(result).toEqual(validatePromotionFailure({ error: 'Invalid code' }));
      done();
    });
  });

  it('redeems promotions and maps failures', (done) => {
    const request = {
      code: 'SAVE10',
      redemptionContext: 'existing' as const,
      subscriptionId: 'sub-1',
      benefitStartsAt: '2026-01-01T00:00:00.000Z',
    };
    const redemption = { id: 'red-1', code: 'SAVE10' } as never;
    actions$ = of(redeemPromotion({ request }));
    promotionsService.redeem.mockReturnValue(of(redemption));

    redeemPromotion$(actions$, promotionsService).subscribe((result) => {
      expect(result).toEqual(redeemPromotionSuccess({ redemption }));
      done();
    });
  });

  it('maps load active failures', (done) => {
    actions$ = of(loadActivePromotions());
    promotionsService.listActive.mockReturnValue(throwError(() => 'network'));

    loadActivePromotions$(actions$, promotionsService).subscribe((result) => {
      expect(result).toEqual(loadActivePromotionsFailure({ error: 'network' }));
      done();
    });
  });

  it('maps redeem failures', (done) => {
    const request = { code: 'SAVE10', redemptionContext: 'existing' as const, subscriptionId: 'sub-1' };
    actions$ = of(redeemPromotion({ request }));
    promotionsService.redeem.mockReturnValue(throwError(() => new Error('Redeem failed')));

    redeemPromotion$(actions$, promotionsService).subscribe((result) => {
      expect(result).toEqual(redeemPromotionFailure({ error: 'Redeem failed' }));
      done();
    });
  });
});
