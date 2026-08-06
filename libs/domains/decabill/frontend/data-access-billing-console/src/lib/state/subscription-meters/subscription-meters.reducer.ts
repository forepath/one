import { createReducer, on } from '@ngrx/store';

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
  entries: UsageMeterEntryResponse[];
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
  on(loadMeterEntries, (state, { subscriptionId }) => ({
    ...state,
    subscriptionId,
    loadingEntries: true,
    error: null,
  })),
  on(loadMeterEntriesSuccess, (state, { subscriptionId, entries }) => ({
    ...state,
    subscriptionId,
    entries,
    loadingEntries: false,
    error: null,
  })),
  on(loadMeterEntriesFailure, (state, { error }) => ({
    ...state,
    loadingEntries: false,
    error,
  })),
  on(createMeterEntry, (state) => ({ ...state, creating: true, error: null })),
  on(createMeterEntrySuccess, (state, { entry }) => ({
    ...state,
    entries: [...state.entries, entry],
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
