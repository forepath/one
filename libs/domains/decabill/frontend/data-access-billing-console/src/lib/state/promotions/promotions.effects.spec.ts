import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Actions } from '@ngrx/effects';
import { of, throwError } from 'rxjs';

import { PromotionsService } from '../../services/promotions.service';

import {
  loadActivePromotions,
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

  it('loads one page of active promotions with the total (replace-page)', (done) => {
    actions$ = of(loadActivePromotions({ search: 'save', page: 2, pageSize: 25 }));
    promotionsService.listActive.mockReturnValue(
      of({ items: [{ id: 'r-1' } as never], total: 26, limit: 25, offset: 25 }),
    );

    loadActivePromotions$(actions$, promotionsService).subscribe((result) => {
      expect(result).toEqual(loadActivePromotionsSuccess({ items: [{ id: 'r-1' } as never], total: 26 }));
      expect(promotionsService.listActive).toHaveBeenCalledWith({ limit: 25, offset: 25, search: 'save' });
      done();
    });
  });

  it('loads one page of promotion redemptions (page 1 by default)', (done) => {
    actions$ = of(loadPromotionRedemptions({}));
    promotionsService.listRedemptions.mockReturnValue(
      of({ items: [{ id: 'r-1' } as never], total: 1, limit: 25, offset: 0 }),
    );

    loadPromotionRedemptions$(actions$, promotionsService).subscribe((result) => {
      expect(result).toEqual(loadPromotionRedemptionsSuccess({ items: [{ id: 'r-1' } as never], total: 1 }));
      expect(promotionsService.listRedemptions).toHaveBeenCalledWith({ limit: 25, offset: 0, search: undefined });
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
    actions$ = of(loadActivePromotions({}));
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
