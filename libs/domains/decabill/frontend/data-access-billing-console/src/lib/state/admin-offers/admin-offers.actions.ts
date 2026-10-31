import { createAction, props } from '@ngrx/store';

import type { BillingAuditLogResponse } from '../../types/billing.types';
import type {
  AdminOfferDetailResponse,
  AdminOfferListItem,
  AdminOfferStatisticsParams,
  CreateAdminOfferDto,
  OfferStatisticsResponse,
  UpdateAdminOfferDto,
} from '../../types/offers.types';

export const loadAdminOffers = createAction(
  '[AdminOffers] Load Offers',
  props<{ search?: string; userId?: string; page?: number; pageSize?: number }>(),
);
export const loadAdminOffersSuccess = createAction(
  '[AdminOffers] Load Offers Success',
  props<{ offers: AdminOfferListItem[]; total: number }>(),
);
export const loadAdminOffersFailure = createAction('[AdminOffers] Load Offers Failure', props<{ error: string }>());

export const loadAdminOfferStatistics = createAction(
  '[AdminOffers] Load Statistics',
  props<{ params: AdminOfferStatisticsParams }>(),
);
export const loadAdminOfferStatisticsSuccess = createAction(
  '[AdminOffers] Load Statistics Success',
  props<{ statistics: OfferStatisticsResponse }>(),
);
export const loadAdminOfferStatisticsFailure = createAction(
  '[AdminOffers] Load Statistics Failure',
  props<{ error: string }>(),
);

export const createAdminOffer = createAction('[AdminOffers] Create Offer', props<{ dto: CreateAdminOfferDto }>());
export const createAdminOfferSuccess = createAction(
  '[AdminOffers] Create Offer Success',
  props<{ offer: AdminOfferDetailResponse }>(),
);
export const createAdminOfferFailure = createAction('[AdminOffers] Create Offer Failure', props<{ error: string }>());

export const updateAdminOffer = createAction(
  '[AdminOffers] Update Offer',
  props<{ id: string; dto: UpdateAdminOfferDto }>(),
);
export const updateAdminOfferSuccess = createAction(
  '[AdminOffers] Update Offer Success',
  props<{ offer: AdminOfferDetailResponse }>(),
);
export const updateAdminOfferFailure = createAction('[AdminOffers] Update Offer Failure', props<{ error: string }>());

export const deleteAdminOffer = createAction('[AdminOffers] Delete Offer', props<{ id: string }>());
export const deleteAdminOfferSuccess = createAction('[AdminOffers] Delete Offer Success', props<{ id: string }>());
export const deleteAdminOfferFailure = createAction('[AdminOffers] Delete Offer Failure', props<{ error: string }>());

export const archiveAdminOffer = createAction('[AdminOffers] Archive Offer', props<{ id: string }>());
export const archiveAdminOfferSuccess = createAction(
  '[AdminOffers] Archive Offer Success',
  props<{ offer: AdminOfferDetailResponse }>(),
);
export const archiveAdminOfferFailure = createAction('[AdminOffers] Archive Offer Failure', props<{ error: string }>());

export const revokeAdminOffer = createAction('[AdminOffers] Revoke Offer', props<{ id: string }>());
export const revokeAdminOfferSuccess = createAction(
  '[AdminOffers] Revoke Offer Success',
  props<{ offer: AdminOfferDetailResponse }>(),
);
export const revokeAdminOfferFailure = createAction('[AdminOffers] Revoke Offer Failure', props<{ error: string }>());

export const loadAdminOfferAuditLogs = createAction(
  '[AdminOffers] Load Audit Logs',
  props<{ offerId: string; limit?: number; offset?: number }>(),
);
export const loadAdminOfferAuditLogsSuccess = createAction(
  '[AdminOffers] Load Audit Logs Success',
  props<{ offerId: string; items: BillingAuditLogResponse[]; total: number; offset: number }>(),
);
export const loadAdminOfferAuditLogsFailure = createAction(
  '[AdminOffers] Load Audit Logs Failure',
  props<{ error: string }>(),
);
