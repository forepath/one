import {
  selectActivePromotions,
  selectCanRedeemPromotion,
  selectPromotionValidationErrorForContext,
  selectPromotionValidationPreviewForContext,
} from './promotions.selectors';
import { initialPromotionsState } from './promotions.reducer';

describe('promotions selectors', () => {
  const state = {
    promotions: {
      ...initialPromotionsState,
      activePromotions: [{ id: 'r-1' } as never],
      validationPreview: { valid: true, code: 'SAVE10' },
      validationContext: 'existing' as const,
      validatedTargetKey: 'save10:sub-1:existing',
    },
  };

  it('selects active promotions', () => {
    expect(selectActivePromotions(state)).toEqual([{ id: 'r-1' }]);
  });

  it('scopes validation preview to context', () => {
    expect(selectPromotionValidationPreviewForContext('existing')(state)).toEqual({
      valid: true,
      code: 'SAVE10',
    });
    expect(selectPromotionValidationPreviewForContext('new')(state)).toBeNull();
  });

  it('scopes validation error to context', () => {
    const withError = {
      promotions: {
        ...state.promotions,
        validationError: 'Invalid code',
      },
    };

    expect(selectPromotionValidationErrorForContext('existing')(withError)).toBe('Invalid code');
    expect(selectPromotionValidationErrorForContext('new')(withError)).toBeNull();
  });

  it('allows redeem only for validated matching target', () => {
    const canRedeem = selectCanRedeemPromotion({
      code: 'SAVE10',
      redemptionContext: 'existing',
      subscriptionId: 'sub-1',
    });

    expect(canRedeem(state)).toBe(true);
    expect(
      selectCanRedeemPromotion({
        code: 'OTHER',
        redemptionContext: 'existing',
        subscriptionId: 'sub-1',
      })(state),
    ).toBe(false);
    expect(selectCanRedeemPromotion(null)(state)).toBe(false);
  });
});
