import { createAction, props } from '@ngrx/store';

import type { BillingAuditLogResponse } from '../../types/billing.types';
import type {
  AcceptAdminOfferDto,
  AdminOfferDetailResponse,
  AdminOfferListItem,
  AdminOfferStatisticsParams,
  ArchiveAdminOfferDto,
  CreateAdminOfferDto,
  DeclineAdminOfferDto,
  OfferStatisticsResponse,
  RevokeAdminOfferDto,
  UpdateAdminOfferDto,
} from '../../types/offers.types';
import type { MarkDocumentSentDto, SpooledDeliveryChannel } from '../../types/spooler.types';

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

/** `sendLetter`: archive without email, then send the offer as a letter (spooled). */
export const archiveAdminOffer = createAction(
  '[AdminOffers] Archive Offer',
  props<{ id: string; dto?: ArchiveAdminOfferDto; sendLetter?: boolean }>(),
);
export const archiveAdminOfferSuccess = createAction(
  '[AdminOffers] Archive Offer Success',
  props<{ offer: AdminOfferDetailResponse }>(),
);
export const archiveAdminOfferFailure = createAction('[AdminOffers] Archive Offer Failure', props<{ error: string }>());

/** Sends an offer archived without notification: email (default) or letter, spooled in the background. */
export const sendAdminOffer = createAction(
  '[AdminOffers] Send Offer',
  props<{ id: string; channel?: SpooledDeliveryChannel }>(),
);

/** Records that an offer was sent outside Decabill (nothing is sent). */
export const markAdminOfferSent = createAction(
  '[AdminOffers] Mark Offer Sent',
  props<{ id: string; dto?: MarkDocumentSentDto }>(),
);
export const markAdminOfferSentSuccess = createAction(
  '[AdminOffers] Mark Offer Sent Success',
  props<{ offer: AdminOfferDetailResponse }>(),
);
export const markAdminOfferSentFailure = createAction(
  '[AdminOffers] Mark Offer Sent Failure',
  props<{ error: string }>(),
);
export const sendAdminOfferSuccess = createAction(
  '[AdminOffers] Send Offer Success',
  props<{ offer: AdminOfferDetailResponse }>(),
);
export const sendAdminOfferFailure = createAction('[AdminOffers] Send Offer Failure', props<{ error: string }>());

export const revokeAdminOffer = createAction(
  '[AdminOffers] Revoke Offer',
  props<{ id: string; dto?: RevokeAdminOfferDto }>(),
);
export const revokeAdminOfferSuccess = createAction(
  '[AdminOffers] Revoke Offer Success',
  props<{ offer: AdminOfferDetailResponse }>(),
);
export const revokeAdminOfferFailure = createAction('[AdminOffers] Revoke Offer Failure', props<{ error: string }>());

export const acceptAdminOffer = createAction(
  '[AdminOffers] Accept Offer',
  props<{ id: string; dto?: AcceptAdminOfferDto }>(),
);
export const acceptAdminOfferSuccess = createAction(
  '[AdminOffers] Accept Offer Success',
  props<{ offer: AdminOfferDetailResponse }>(),
);
export const acceptAdminOfferFailure = createAction('[AdminOffers] Accept Offer Failure', props<{ error: string }>());

export const declineAdminOffer = createAction(
  '[AdminOffers] Decline Offer',
  props<{ id: string; dto?: DeclineAdminOfferDto }>(),
);
export const declineAdminOfferSuccess = createAction(
  '[AdminOffers] Decline Offer Success',
  props<{ offer: AdminOfferDetailResponse }>(),
);
export const declineAdminOfferFailure = createAction('[AdminOffers] Decline Offer Failure', props<{ error: string }>());

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
