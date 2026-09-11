import { createAction, props } from '@ngrx/store';

import type {
  CustomerOfferDetailResponse,
  CustomerOfferListItem,
  OffersSummaryResponse,
} from '../../types/offers.types';

export const loadOffersSummary = createAction('[Offers] Load Summary', (silent = false) => ({ silent }));
export const loadOffersSummarySuccess = createAction(
  '[Offers] Load Summary Success',
  props<{ summary: OffersSummaryResponse }>(),
);
export const loadOffersSummaryFailure = createAction('[Offers] Load Summary Failure', props<{ error: string }>());

export const loadPendingOffers = createAction(
  '[Offers] Load Pending Offers',
  props<{ silent?: boolean; search?: string }>(),
);
export const loadPendingOffersSuccess = createAction(
  '[Offers] Load Pending Offers Success',
  props<{ offers: CustomerOfferListItem[] }>(),
);
export const loadPendingOffersFailure = createAction(
  '[Offers] Load Pending Offers Failure',
  props<{ error: string }>(),
);

export const loadHistoryOffers = createAction(
  '[Offers] Load History Offers',
  props<{ silent?: boolean; search?: string }>(),
);
export const loadHistoryOffersSuccess = createAction(
  '[Offers] Load History Offers Success',
  props<{ offers: CustomerOfferListItem[] }>(),
);
export const loadHistoryOffersFailure = createAction(
  '[Offers] Load History Offers Failure',
  props<{ error: string }>(),
);

export const loadOfferDetails = createAction(
  '[Offers] Load Offer Details',
  props<{ offerId: string; silent?: boolean }>(),
);
export const loadOfferDetailsSuccess = createAction(
  '[Offers] Load Offer Details Success',
  props<{ offerId: string; detail: CustomerOfferDetailResponse }>(),
);
export const loadOfferDetailsFailure = createAction('[Offers] Load Offer Details Failure', props<{ error: string }>());

export const acceptOffer = createAction('[Offers] Accept Offer', props<{ offerId: string }>());
export const acceptOfferSuccess = createAction(
  '[Offers] Accept Offer Success',
  props<{ offer: CustomerOfferDetailResponse }>(),
);
export const acceptOfferFailure = createAction('[Offers] Accept Offer Failure', props<{ error: string }>());

export const declineOffer = createAction('[Offers] Decline Offer', props<{ offerId: string }>());
export const declineOfferSuccess = createAction(
  '[Offers] Decline Offer Success',
  props<{ offer: CustomerOfferDetailResponse }>(),
);
export const declineOfferFailure = createAction('[Offers] Decline Offer Failure', props<{ error: string }>());

export const clearOffers = createAction('[Offers] Clear Offers');
