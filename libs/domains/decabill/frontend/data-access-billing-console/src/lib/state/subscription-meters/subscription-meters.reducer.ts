import { createReducer, on } from '@ngrx/store';

import { BILLING_LIST_PAGE_SIZE, billingPageWindow } from '../../constants/list-paging.constants';

import type { SubscriptionMeterSummary, UsageMeterEntryResponse } from '../../types/billing.types';

import {
  clearSubscriptionMeters,
  createMeterEntry,
  createMeterEntryFailure,
  createMeterEntrySuccess,
  deleteMeterEntry,
  deleteMeterEntryFailure,
  deleteMeterEntrySuccess,
  loadMeterEntries,
  loadMeterEntriesFailure,
  loadMeterEntriesSuccess,
  loadSubscriptionMeters,
  loadSubscriptionMetersFailure,
  loadSubscriptionMetersSuccess,
  updateMeterEntry,
  updateMeterEntryFailure,
  updateMeterEntrySuccess,
} from './subscription-meters.actions';

export interface SubscriptionMetersState {
  subscriptionId: string | null;
  summaries: SubscriptionMeterSummary[];
  /** Current page of the meter entries (replace-page) with the server total, 1-based page and its size. */
  entries: UsageMeterEntryResponse[];
  entriesTotal: number;
  entriesPage: number;
  entriesPageSize: number;
  loadingSummaries: boolean;
  loadingEntries: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  error: string | null;
}

export const initialSubscriptionMetersState: SubscriptionMetersState = {
  subscriptionId: null,
  summaries: [],
  entries: [],
  entriesTotal: 0,
  entriesPage: 1,
  entriesPageSize: BILLING_LIST_PAGE_SIZE,
  loadingSummaries: false,
  loadingEntries: false,
  creating: false,
  updating: false,
  deleting: false,
  error: null,
};

export const subscriptionMetersReducer = createReducer(
  initialSubscriptionMetersState,
  on(loadSubscriptionMeters, (state, { subscriptionId }) => ({
    ...state,
    subscriptionId,
    loadingSummaries: true,
    error: null,
  })),
  on(loadSubscriptionMetersSuccess, (state, { subscriptionId, summaries }) => ({
    ...state,
    subscriptionId,
    summaries,
    loadingSummaries: false,
    error: null,
  })),
  on(loadSubscriptionMetersFailure, (state, { error }) => ({
    ...state,
    loadingSummaries: false,
    error,
  })),
  on(loadMeterEntries, (state, { subscriptionId, page, pageSize }) => {
    const window = billingPageWindow(page, pageSize ?? state.entriesPageSize);
    const sameSubscription = state.subscriptionId === subscriptionId;

    return {
      ...state,
      subscriptionId,
      // Another subscription starts empty; the same one keeps its rows until the page arrives.
      entries: sameSubscription ? state.entries : [],
      entriesTotal: sameSubscription ? state.entriesTotal : 0,
      entriesPage: window.page,
      entriesPageSize: window.pageSize,
      loadingEntries: true,
      error: null,
    };
  }),
  on(loadMeterEntriesSuccess, (state, { subscriptionId, entries, total }) => ({
    ...state,
    subscriptionId,
    entries,
    entriesTotal: total,
    loadingEntries: false,
    error: null,
  })),
  on(loadMeterEntriesFailure, (state, { error }) => ({
    ...state,
    loadingEntries: false,
    error,
  })),
  on(createMeterEntry, (state) => ({ ...state, creating: true, error: null })),
  // The current page is reloaded after a create / delete (server order, total).
  on(createMeterEntrySuccess, (state) => ({
    ...state,
    creating: false,
    error: null,
  })),
  on(createMeterEntryFailure, (state, { error }) => ({ ...state, creating: false, error })),
  on(updateMeterEntry, (state) => ({ ...state, updating: true, error: null })),
  on(updateMeterEntrySuccess, (state, { entry }) => ({
    ...state,
    entries: state.entries.map((item) => (item.id === entry.id ? entry : item)),
    updating: false,
    error: null,
  })),
  on(updateMeterEntryFailure, (state, { error }) => ({ ...state, updating: false, error })),
  on(deleteMeterEntry, (state) => ({ ...state, deleting: true, error: null })),
  on(deleteMeterEntrySuccess, (state, { entryId }) => ({
    ...state,
    entries: state.entries.filter((item) => item.id !== entryId),
    deleting: false,
    error: null,
  })),
  on(deleteMeterEntryFailure, (state, { error }) => ({ ...state, deleting: false, error })),
  on(clearSubscriptionMeters, () => initialSubscriptionMetersState),
);
