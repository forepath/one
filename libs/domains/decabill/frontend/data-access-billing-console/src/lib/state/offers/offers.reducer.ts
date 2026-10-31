import { createReducer, on } from '@ngrx/store';

import { BILLING_LIST_PAGE_SIZE, billingPageWindow } from '../../constants/list-paging.constants';

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
  /** Replace-page paging (server total, 1-based page and its size) of the pending list. */
  pendingTotal: number;
  pendingPage: number;
  pendingPageSize: number;
  historyList: CustomerOfferListItem[];
  historyListLoading: boolean;
  historyListError: string | null;
  historySearch: string | null;
  historyTotal: number;
  historyPage: number;
  historyPageSize: number;
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
  pendingTotal: 0,
  pendingPage: 1,
  pendingPageSize: BILLING_LIST_PAGE_SIZE,
  historyList: [],
  historyListLoading: false,
  historyListError: null,
  historySearch: null,
  historyTotal: 0,
  historyPage: 1,
  historyPageSize: BILLING_LIST_PAGE_SIZE,
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
  on(loadPendingOffers, (state, { silent, search, page, pageSize }) => {
    const window = billingPageWindow(page, pageSize ?? state.pendingPageSize);
    const query = {
      pendingPage: window.page,
      pendingPageSize: window.pageSize,
      pendingSearch: search?.trim() ? search.trim() : null,
    };

    return silent ? { ...state, ...query } : { ...state, ...query, pendingListLoading: true, pendingListError: null };
  }),
  on(loadPendingOffersSuccess, (state, { offers, total }) => ({
    ...state,
    pendingList: offers,
    pendingTotal: total,
    pendingListLoading: false,
    pendingListError: null,
  })),
  on(loadPendingOffersFailure, (state, { error }) => ({
    ...state,
    pendingListLoading: false,
    pendingListError: error,
  })),
  on(loadHistoryOffers, (state, { silent, search, page, pageSize }) => {
    const window = billingPageWindow(page, pageSize ?? state.historyPageSize);
    const query = {
      historyPage: window.page,
      historyPageSize: window.pageSize,
      historySearch: search?.trim() ? search.trim() : null,
    };

    return silent ? { ...state, ...query } : { ...state, ...query, historyListLoading: true, historyListError: null };
  }),
  on(loadHistoryOffersSuccess, (state, { offers, total }) => ({
    ...state,
    historyList: offers,
    historyTotal: total,
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
