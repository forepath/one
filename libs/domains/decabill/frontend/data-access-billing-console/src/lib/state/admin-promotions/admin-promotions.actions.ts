import { createAction, props } from '@ngrx/store';

import type {
  AdminPromotionResponse,
  CreateAdminPromotionDto,
  PromotionRedemptionResponse,
  UpdateAdminPromotionDto,
} from '../../types/promotions.types';

export const loadAdminPromotions = createAction(
  '[AdminPromotions] Load Promotions',
  props<{ search?: string; page?: number; pageSize?: number }>(),
);
export const loadAdminPromotionsSuccess = createAction(
  '[AdminPromotions] Load Promotions Success',
  props<{ promotions: AdminPromotionResponse[]; total: number }>(),
);
export const loadAdminPromotionsFailure = createAction(
  '[AdminPromotions] Load Promotions Failure',
  props<{ error: string }>(),
);

export const createAdminPromotion = createAction(
  '[AdminPromotions] Create Promotion',
  props<{ dto: CreateAdminPromotionDto }>(),
);
export const createAdminPromotionSuccess = createAction(
  '[AdminPromotions] Create Promotion Success',
  props<{ promotion: AdminPromotionResponse }>(),
);
export const createAdminPromotionFailure = createAction(
  '[AdminPromotions] Create Promotion Failure',
  props<{ error: string }>(),
);

export const updateAdminPromotion = createAction(
  '[AdminPromotions] Update Promotion',
  props<{ id: string; dto: UpdateAdminPromotionDto }>(),
);
export const updateAdminPromotionSuccess = createAction(
  '[AdminPromotions] Update Promotion Success',
  props<{ promotion: AdminPromotionResponse }>(),
);
export const updateAdminPromotionFailure = createAction(
  '[AdminPromotions] Update Promotion Failure',
  props<{ error: string }>(),
);

export const deactivateAdminPromotion = createAction('[AdminPromotions] Deactivate Promotion', props<{ id: string }>());
export const deactivateAdminPromotionSuccess = createAction(
  '[AdminPromotions] Deactivate Promotion Success',
  props<{ promotion: AdminPromotionResponse }>(),
);
export const deactivateAdminPromotionFailure = createAction(
  '[AdminPromotions] Deactivate Promotion Failure',
  props<{ error: string }>(),
);

export const loadAdminPromotionRedemptions = createAction(
  '[AdminPromotions] Load Promotion Redemptions',
  props<{ promotionId: string; page?: number; pageSize?: number }>(),
);
export const loadAdminPromotionRedemptionsSuccess = createAction(
  '[AdminPromotions] Load Promotion Redemptions Success',
  props<{ redemptions: PromotionRedemptionResponse[]; total: number }>(),
);
export const loadAdminPromotionRedemptionsFailure = createAction(
  '[AdminPromotions] Load Promotion Redemptions Failure',
  props<{ error: string }>(),
);
