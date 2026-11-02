import {
  createAdminPromotion,
  createAdminPromotionSuccess,
  deactivateAdminPromotionSuccess,
  loadAdminPromotionRedemptions,
  loadAdminPromotionRedemptionsSuccess,
  loadAdminPromotions,
  loadAdminPromotionsSuccess,
  updateAdminPromotionSuccess,
} from './admin-promotions.actions';
import { adminPromotionsReducer, initialAdminPromotionsState } from './admin-promotions.reducer';

describe('adminPromotionsReducer', () => {
  const promotion = { id: 'promo-1', code: 'SAVE10', name: 'Save 10' } as never;

  it('stores one loaded page with the total (replace-page)', () => {
    const loading = adminPromotionsReducer(
      { ...initialAdminPromotionsState, promotions: [{ id: 'old' } as never] },
      loadAdminPromotions({ search: ' save ', page: 3, pageSize: 50 }),
    );

    expect(loading).toEqual(expect.objectContaining({ loading: true, page: 3, pageSize: 50, search: 'save' }));

    const state = adminPromotionsReducer(loading, loadAdminPromotionsSuccess({ promotions: [promotion], total: 101 }));

    expect(state.promotions).toEqual([promotion]);
    expect(state.total).toBe(101);
    expect(state.loading).toBe(false);
  });

  it('pages redemptions per promotion and clears them when another promotion opens', () => {
    const first = adminPromotionsReducer(
      initialAdminPromotionsState,
      loadAdminPromotionRedemptions({ promotionId: 'p1', page: 2 }),
    );
    const loaded = adminPromotionsReducer(
      first,
      loadAdminPromotionRedemptionsSuccess({ redemptions: [{ id: 'r1' } as never], total: 30 }),
    );

    expect(loaded).toEqual(
      expect.objectContaining({ redemptionsPage: 2, redemptionsTotal: 30, redemptionsPromotionId: 'p1' }),
    );

    const samePromotion = adminPromotionsReducer(loaded, loadAdminPromotionRedemptions({ promotionId: 'p1', page: 1 }));

    expect(samePromotion.redemptions).toHaveLength(1);

    const other = adminPromotionsReducer(loaded, loadAdminPromotionRedemptions({ promotionId: 'p2' }));

    expect(other.redemptions).toEqual([]);
    expect(other.redemptionsTotal).toBe(0);
    expect(other.redemptionsPage).toBe(1);
  });

  it('tracks create/update/deactivate lifecycle', () => {
    const creating = adminPromotionsReducer(initialAdminPromotionsState, createAdminPromotion({ dto: {} as never }));
    expect(creating.creating).toBe(true);

    const created = adminPromotionsReducer(creating, createAdminPromotionSuccess({ promotion }));
    expect(created.creating).toBe(false);
    expect(created.promotions[0]).toEqual(promotion);

    const updated = adminPromotionsReducer(
      created,
      updateAdminPromotionSuccess({ promotion: { ...promotion, name: 'Updated' } as never }),
    );
    expect(updated.promotions[0].name).toBe('Updated');

    const deactivated = adminPromotionsReducer(
      updated,
      deactivateAdminPromotionSuccess({ promotion: { ...promotion, isActive: false } as never }),
    );
    expect(deactivated.promotions[0].isActive).toBe(false);
  });
});
