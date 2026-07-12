import { createAction, props } from '@ngrx/store';

import type {
  PromotionRedemptionResponse,
  PromotionValidationResponse,
  RedeemPromotionRequest,
  ValidatePromotionRequest,
} from '../../types/promotions.types';

export const loadActivePromotions = createAction('[Promotions] Load Active Promotions');
export const loadActivePromotionsBatch = createAction(
  '[Promotions] Load Active Promotions Batch',
  props<{ offset: number; accumulated: PromotionRedemptionResponse[] }>(),
);
export const loadActivePromotionsSuccess = createAction(
  '[Promotions] Load Active Promotions Success',
  props<{ items: PromotionRedemptionResponse[] }>(),
);
export const loadActivePromotionsFailure = createAction(
  '[Promotions] Load Active Promotions Failure',
  props<{ error: string }>(),
);

export const loadPromotionRedemptions = createAction('[Promotions] Load Redemptions');
export const loadPromotionRedemptionsBatch = createAction(
  '[Promotions] Load Redemptions Batch',
  props<{ offset: number; accumulated: PromotionRedemptionResponse[] }>(),
);
export const loadPromotionRedemptionsSuccess = createAction(
  '[Promotions] Load Redemptions Success',
  props<{ items: PromotionRedemptionResponse[] }>(),
);
export const loadPromotionRedemptionsFailure = createAction(
  '[Promotions] Load Redemptions Failure',
  props<{ error: string }>(),
);

export const validatePromotion = createAction(
  '[Promotions] Validate Promotion',
  props<{ request: ValidatePromotionRequest }>(),
);
export const validatePromotionSuccess = createAction(
  '[Promotions] Validate Promotion Success',
  props<{ request: ValidatePromotionRequest; preview: PromotionValidationResponse }>(),
);
export const validatePromotionFailure = createAction(
  '[Promotions] Validate Promotion Failure',
  props<{ error: string }>(),
);
export const clearPromotionValidation = createAction('[Promotions] Clear Validation');

export const redeemPromotion = createAction(
  '[Promotions] Redeem Promotion',
  props<{ request: RedeemPromotionRequest }>(),
);
export const redeemPromotionSuccess = createAction(
  '[Promotions] Redeem Promotion Success',
  props<{ redemption: PromotionRedemptionResponse }>(),
);
export const redeemPromotionFailure = createAction('[Promotions] Redeem Promotion Failure', props<{ error: string }>());
