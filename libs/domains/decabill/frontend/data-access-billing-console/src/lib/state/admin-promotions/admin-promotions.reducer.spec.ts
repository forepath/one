import {
  createAdminPromotion,
  createAdminPromotionSuccess,
  deactivateAdminPromotionSuccess,
  loadAdminPromotionsSuccess,
  updateAdminPromotionSuccess,
} from './admin-promotions.actions';
import { adminPromotionsReducer, initialAdminPromotionsState } from './admin-promotions.reducer';

describe('adminPromotionsReducer', () => {
  const promotion = { id: 'promo-1', code: 'SAVE10', name: 'Save 10' } as never;

  it('stores loaded promotions', () => {
    const state = adminPromotionsReducer(
      initialAdminPromotionsState,
      loadAdminPromotionsSuccess({ promotions: [promotion] }),
    );

    expect(state.promotions).toEqual([promotion]);
    expect(state.loading).toBe(false);
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
