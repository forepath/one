import { createReducer, on } from '@ngrx/store';

import type {
  CustomerOfferDetailResponse,
  CustomerOfferListItem,
  OffersSummaryResponse,
} from '../../types/offers.types';

import {
  acceptOffer,
  acceptOfferFailure,
  acceptOfferSuccess,
  clearOffers,
  declineOffer,
  declineOfferFailure,
  declineOfferSuccess,
  loadHistoryOffers,
  loadHistoryOffersFailure,
  loadHistoryOffersSuccess,
  loadOfferDetails,
  loadOfferDetailsFailure,
  loadOfferDetailsSuccess,
  loadOffersSummary,
  loadOffersSummaryFailure,
  loadOffersSummarySuccess,
  loadPendingOffers,
  loadPendingOffersFailure,
  loadPendingOffersSuccess,
} from './offers.actions';

export interface OffersState {
  summary: OffersSummaryResponse | null;
  summaryLoading: boolean;
  summaryError: string | null;
  pendingList: CustomerOfferListItem[];
  pendingListLoading: boolean;
  pendingListError: string | null;
  pendingSearch: string | null;
  historyList: CustomerOfferListItem[];
  historyListLoading: boolean;
  historyListError: string | null;
  historySearch: string | null;
  offerDetails: Record<string, CustomerOfferDetailResponse>;
  detailsLoading: boolean;
  respondingOfferId: string | null;
  error: string | null;
}

export const initialOffersState: OffersState = {
  summary: null,
  summaryLoading: false,
  summaryError: null,
  pendingList: [],
  pendingListLoading: false,
  pendingListError: null,
  pendingSearch: null,
  historyList: [],
  historyListLoading: false,
  historyListError: null,
  historySearch: null,
  offerDetails: {},
  detailsLoading: false,
  respondingOfferId: null,
  error: null,
};

export const offersReducer = createReducer(
  initialOffersState,
  on(loadOffersSummary, (state, { silent }) =>
    silent
      ? state
      : {
          ...state,
          summaryLoading: true,
          summaryError: null,
        },
  ),
  on(loadOffersSummarySuccess, (state, { summary }) => ({
    ...state,
    summary,
    summaryLoading: false,
    summaryError: null,
  })),
  on(loadOffersSummaryFailure, (state, { error }) => ({
    ...state,
    summaryLoading: false,
    summaryError: error,
  })),
  on(loadPendingOffers, (state, { silent, search }) =>
    silent
      ? state
      : {
          ...state,
          pendingListLoading: true,
          pendingListError: null,
          pendingSearch: search?.trim() ? search.trim() : null,
        },
  ),
  on(loadPendingOffersSuccess, (state, { offers }) => ({
    ...state,
    pendingList: offers,
    pendingListLoading: false,
    pendingListError: null,
  })),
  on(loadPendingOffersFailure, (state, { error }) => ({
    ...state,
    pendingListLoading: false,
    pendingListError: error,
  })),
  on(loadHistoryOffers, (state, { silent, search }) =>
    silent
      ? state
      : {
          ...state,
          historyListLoading: true,
          historyListError: null,
          historySearch: search?.trim() ? search.trim() : null,
        },
  ),
  on(loadHistoryOffersSuccess, (state, { offers }) => ({
    ...state,
    historyList: offers,
    historyListLoading: false,
    historyListError: null,
  })),
  on(loadHistoryOffersFailure, (state, { error }) => ({
    ...state,
    historyListLoading: false,
    historyListError: error,
  })),
  on(loadOfferDetails, (state, { silent }) =>
    silent
      ? state
      : {
          ...state,
          detailsLoading: true,
          error: null,
        },
  ),
  on(loadOfferDetailsSuccess, (state, { offerId, detail }) => ({
    ...state,
    offerDetails: { ...state.offerDetails, [offerId]: detail },
    detailsLoading: false,
    error: null,
  })),
  on(loadOfferDetailsFailure, (state, { error }) => ({
    ...state,
    detailsLoading: false,
    error,
  })),
  on(acceptOffer, declineOffer, (state, { offerId }) => ({
    ...state,
    respondingOfferId: offerId,
    error: null,
  })),
  on(acceptOfferSuccess, declineOfferSuccess, (state, { offer }) => ({
    ...state,
    respondingOfferId: null,
    offerDetails: { ...state.offerDetails, [offer.id]: offer },
    error: null,
  })),
  on(acceptOfferFailure, declineOfferFailure, (state, { error }) => ({
    ...state,
    respondingOfferId: null,
    error,
  })),
  on(clearOffers, () => initialOffersState),
);
