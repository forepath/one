import { createReducer, on } from '@ngrx/store';

import {
  clearPromotionValidation,
  loadActivePromotions,
  loadActivePromotionsFailure,
  loadActivePromotionsSuccess,
  loadPromotionRedemptions,
  loadPromotionRedemptionsFailure,
  loadPromotionRedemptionsSuccess,
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

  it('stores one page of active promotions (replace-page) with its total', () => {
    const loading = promotionsReducer(
      { ...initialPromotionsState, activePromotions: [{ id: 'old' } as never] },
      loadActivePromotions({ page: 3, pageSize: 50, search: ' x ' }),
    );

    expect(loading.activePage).toBe(3);
    expect(loading.activePageSize).toBe(50);
    expect(loading.activeSearch).toBe('x');
    expect(loading.loadingActive).toBe(true);

    const state = promotionsReducer(
      loading,
      loadActivePromotionsSuccess({ items: [{ id: 'r-1' } as never], total: 101 }),
    );

    expect(state.activePromotions).toEqual([{ id: 'r-1' }]);
    expect(state.activeTotal).toBe(101);
    expect(state.loadingActive).toBe(false);
  });

  it('stores one page of redemptions with its total', () => {
    const loading = promotionsReducer(initialPromotionsState, loadPromotionRedemptions({ page: 2 }));

    expect(loading.redemptionsPage).toBe(2);
    expect(loading.redemptionsPageSize).toBe(25);

    const state = promotionsReducer(
      loading,
      loadPromotionRedemptionsSuccess({ items: [{ id: 'r-2' } as never], total: 30 }),
    );

    expect(state.redemptions).toEqual([{ id: 'r-2' }]);
    expect(state.redemptionsTotal).toBe(30);
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
