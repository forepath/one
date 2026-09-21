import { createReducer, on } from '@ngrx/store';

import type { BillingAuditLogResponse } from '../../types/billing.types';
import type { AdminOfferListItem, OfferStatisticsResponse } from '../../types/offers.types';

import {
  archiveAdminOffer,
  archiveAdminOfferFailure,
  archiveAdminOfferSuccess,
  createAdminOffer,
  createAdminOfferFailure,
  createAdminOfferSuccess,
  deleteAdminOffer,
  deleteAdminOfferFailure,
  deleteAdminOfferSuccess,
  loadAdminOfferAuditLogs,
  loadAdminOfferAuditLogsFailure,
  loadAdminOfferAuditLogsSuccess,
  loadAdminOfferStatistics,
  loadAdminOfferStatisticsFailure,
  loadAdminOfferStatisticsSuccess,
  loadAdminOffers,
  loadAdminOffersBatch,
  loadAdminOffersFailure,
  loadAdminOffersSuccess,
  loadMoreAdminOfferAuditLogs,
  loadMoreAdminOfferAuditLogsFailure,
  loadMoreAdminOfferAuditLogsSuccess,
  revokeAdminOffer,
  revokeAdminOfferFailure,
  revokeAdminOfferSuccess,
  updateAdminOffer,
  updateAdminOfferFailure,
  updateAdminOfferSuccess,
} from './admin-offers.actions';

export interface AdminOffersState {
  offers: AdminOfferListItem[];
  loading: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  archiving: boolean;
  revoking: boolean;
  error: string | null;
  search: string | null;
  userId: string | null;
  statistics: OfferStatisticsResponse | null;
  statisticsLoading: boolean;
  statisticsError: string | null;
  auditLogsByOffer: Record<string, BillingAuditLogResponse[]>;
  auditLogsTotalByOffer: Record<string, number>;
  auditLogsOffsetByOffer: Record<string, number>;
  auditLogsLoading: boolean;
  auditLogsAppendLoading: boolean;
  auditLogsError: string | null;
}

export const initialAdminOffersState: AdminOffersState = {
  offers: [],
  loading: false,
  creating: false,
  updating: false,
  deleting: false,
  archiving: false,
  revoking: false,
  error: null,
  search: null,
  userId: null,
  statistics: null,
  statisticsLoading: false,
  statisticsError: null,
  auditLogsByOffer: {},
  auditLogsTotalByOffer: {},
  auditLogsOffsetByOffer: {},
  auditLogsLoading: false,
  auditLogsAppendLoading: false,
  auditLogsError: null,
};

function upsertOffer(offers: AdminOfferListItem[], offer: AdminOfferListItem): AdminOfferListItem[] {
  const index = offers.findIndex((item) => item.id === offer.id);

  if (index === -1) {
    return [offer, ...offers];
  }

  const next = [...offers];

  next[index] = offer;

  return next;
}

export const adminOffersReducer = createReducer(
  initialAdminOffersState,
  on(loadAdminOffers, (state, { search, userId }) => ({
    ...state,
    offers: [],
    loading: true,
    error: null,
    search: search?.trim() ? search.trim() : null,
    userId: userId ?? null,
  })),
  on(loadAdminOffersBatch, (state, { accumulated }) => ({
    ...state,
    offers: accumulated,
    loading: true,
  })),
  on(loadAdminOffersSuccess, (state, { offers }) => ({
    ...state,
    offers,
    loading: false,
    error: null,
  })),
  on(loadAdminOffersFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(loadAdminOfferStatistics, (state) => ({
    ...state,
    statisticsLoading: true,
    statisticsError: null,
  })),
  on(loadAdminOfferStatisticsSuccess, (state, { statistics }) => ({
    ...state,
    statistics,
    statisticsLoading: false,
    statisticsError: null,
  })),
  on(loadAdminOfferStatisticsFailure, (state, { error }) => ({
    ...state,
    statisticsLoading: false,
    statisticsError: error,
  })),
  on(createAdminOffer, (state) => ({ ...state, creating: true, error: null })),
  on(createAdminOfferSuccess, (state, { offer }) => ({
    ...state,
    creating: false,
    offers: upsertOffer(state.offers, offer),
  })),
  on(createAdminOfferFailure, (state, { error }) => ({ ...state, creating: false, error })),
  on(updateAdminOffer, (state) => ({ ...state, updating: true, error: null })),
  on(updateAdminOfferSuccess, (state, { offer }) => ({
    ...state,
    updating: false,
    offers: upsertOffer(state.offers, offer),
  })),
  on(updateAdminOfferFailure, (state, { error }) => ({ ...state, updating: false, error })),
  on(deleteAdminOffer, (state) => ({ ...state, deleting: true, error: null })),
  on(deleteAdminOfferSuccess, (state, { id }) => ({
    ...state,
    deleting: false,
    offers: state.offers.filter((offer) => offer.id !== id),
  })),
  on(deleteAdminOfferFailure, (state, { error }) => ({ ...state, deleting: false, error })),
  on(archiveAdminOffer, (state) => ({ ...state, archiving: true, error: null })),
  on(archiveAdminOfferSuccess, (state, { offer }) => ({
    ...state,
    archiving: false,
    offers: upsertOffer(state.offers, offer),
  })),
  on(archiveAdminOfferFailure, (state, { error }) => ({ ...state, archiving: false, error })),
  on(revokeAdminOffer, (state) => ({ ...state, revoking: true, error: null })),
  on(revokeAdminOfferSuccess, (state, { offer }) => ({
    ...state,
    revoking: false,
    offers: upsertOffer(state.offers, offer),
  })),
  on(revokeAdminOfferFailure, (state, { error }) => ({ ...state, revoking: false, error })),
  on(loadAdminOfferAuditLogs, (state, { offerId }) => ({
    ...state,
    auditLogsLoading: true,
    auditLogsError: null,
    auditLogsByOffer: { ...state.auditLogsByOffer, [offerId]: [] },
    auditLogsOffsetByOffer: { ...state.auditLogsOffsetByOffer, [offerId]: 0 },
  })),
  on(loadAdminOfferAuditLogsSuccess, (state, { offerId, items, total, offset }) => ({
    ...state,
    auditLogsLoading: false,
    auditLogsByOffer: { ...state.auditLogsByOffer, [offerId]: items },
    auditLogsTotalByOffer: { ...state.auditLogsTotalByOffer, [offerId]: total },
    auditLogsOffsetByOffer: { ...state.auditLogsOffsetByOffer, [offerId]: offset },
  })),
  on(loadAdminOfferAuditLogsFailure, (state, { error }) => ({
    ...state,
    auditLogsLoading: false,
    auditLogsError: error,
  })),
  on(loadMoreAdminOfferAuditLogs, (state) => ({
    ...state,
    auditLogsAppendLoading: true,
    auditLogsError: null,
  })),
  on(loadMoreAdminOfferAuditLogsSuccess, (state, { offerId, items, total, offset }) => ({
    ...state,
    auditLogsAppendLoading: false,
    auditLogsByOffer: {
      ...state.auditLogsByOffer,
      [offerId]: [...(state.auditLogsByOffer[offerId] ?? []), ...items],
    },
    auditLogsTotalByOffer: { ...state.auditLogsTotalByOffer, [offerId]: total },
    auditLogsOffsetByOffer: { ...state.auditLogsOffsetByOffer, [offerId]: offset },
  })),
  on(loadMoreAdminOfferAuditLogsFailure, (state, { error }) => ({
    ...state,
    auditLogsAppendLoading: false,
    auditLogsError: error,
  })),
);
