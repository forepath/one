import { createReducer, on } from '@ngrx/store';

import {
  clearPromotionValidation,
  loadActivePromotionsFailure,
  loadActivePromotionsSuccess,
  loadPromotionRedemptionsFailure,
  redeemPromotion,
  redeemPromotionFailure,
  redeemPromotionSuccess,
  validatePromotion,
  validatePromotionFailure,
  validatePromotionSuccess,
} from './promotions.actions';
import { buildPromotionTargetKey, initialPromotionsState, promotionsReducer } from './promotions.reducer';

describe('promotionsReducer', () => {
  it('stores validation preview and target key on success', () => {
    const request = {
      code: 'SAVE10',
      redemptionContext: 'existing' as const,
      subscriptionId: 'sub-1',
    };
    const state = promotionsReducer(
      initialPromotionsState,
      validatePromotionSuccess({
        request,
        preview: {
          valid: true,
          code: 'SAVE10',
          advantageSummary: '€10 off',
        },
      }),
    );

    expect(state.validationPreview?.valid).toBe(true);
    expect(state.validationContext).toBe('existing');
    expect(state.validatedTargetKey).toBe(buildPromotionTargetKey(request));
  });

  it('clears validation state', () => {
    const withPreview = promotionsReducer(
      initialPromotionsState,
      validatePromotionSuccess({
        request: { code: 'X', redemptionContext: 'new', planId: 'plan-1' },
        preview: { valid: true },
      }),
    );
    const cleared = promotionsReducer(withPreview, clearPromotionValidation());

    expect(cleared.validationPreview).toBeNull();
    expect(cleared.validationContext).toBeNull();
    expect(cleared.validatedTargetKey).toBeNull();
  });

  it('stores active promotions', () => {
    const state = promotionsReducer(
      initialPromotionsState,
      loadActivePromotionsSuccess({ items: [{ id: 'r-1' } as never] }),
    );

    expect(state.activePromotions).toHaveLength(1);
    expect(state.loadingActive).toBe(false);
  });

  it('tracks validation and redeem lifecycle states', () => {
    const validating = promotionsReducer(
      initialPromotionsState,
      validatePromotion({ request: { code: 'SAVE10', redemptionContext: 'new', planId: 'plan-1' } }),
    );
    expect(validating.validationLoading).toBe(true);
    expect(validating.validationContext).toBe('new');

    const invalid = promotionsReducer(
      validating,
      validatePromotionSuccess({
        request: { code: 'BAD', redemptionContext: 'new', planId: 'plan-1' },
        preview: { valid: false, message: 'Invalid' },
      }),
    );
    expect(invalid.validationError).toBe('Invalid');
    expect(invalid.validatedTargetKey).toBeNull();

    const failed = promotionsReducer(validating, validatePromotionFailure({ error: 'Network error' }));
    expect(failed.validationError).toBe('Network error');

    const redeeming = promotionsReducer(invalid, redeemPromotion());
    expect(redeeming.redeeming).toBe(true);

    const redeemed = promotionsReducer(redeeming, redeemPromotionSuccess({ redemption: { id: 'red-1' } as never }));
    expect(redeemed.redeeming).toBe(false);
    expect(redeemed.activePromotions[0].id).toBe('red-1');
    expect(redeemed.validationPreview).toBeNull();

    const redeemFailed = promotionsReducer(redeeming, redeemPromotionFailure({ error: 'Redeem failed' }));
    expect(redeemFailed.redeemError).toBe('Redeem failed');
  });

  it('stores load failures', () => {
    const activeFailed = promotionsReducer(
      initialPromotionsState,
      loadActivePromotionsFailure({ error: 'active fail' }),
    );
    expect(activeFailed.error).toBe('active fail');

    const historyFailed = promotionsReducer(
      initialPromotionsState,
      loadPromotionRedemptionsFailure({ error: 'history fail' }),
    );
    expect(historyFailed.error).toBe('history fail');
  });
});

describe('buildPromotionTargetKey', () => {
  it('builds stable key from code target and context', () => {
    expect(
      buildPromotionTargetKey({
        code: ' Save10 ',
        redemptionContext: 'new',
        planId: 'plan-1',
      }),
    ).toBe('save10:plan-1:new');
  });
});
