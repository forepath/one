import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { StatisticsState } from './statistics.reducer';

export const selectStatisticsState = createFeatureSelector<StatisticsState>('statistics');

// Client-scoped selectors
export const selectClientSummary = (clientId: string) =>
  createSelector(selectStatisticsState, (state) => state.clientSummary[clientId]);

export const selectClientChatIo = (clientId: string) =>
  createSelector(selectStatisticsState, (state) => state.clientChatIo[clientId]);

export const selectClientFilterDrops = (clientId: string) =>
  createSelector(selectStatisticsState, (state) => state.clientFilterDrops[clientId]);

export const selectClientFilterFlags = (clientId: string) =>
  createSelector(selectStatisticsState, (state) => state.clientFilterFlags[clientId]);

export const selectClientEntityEvents = (clientId: string) =>
  createSelector(selectStatisticsState, (state) => state.clientEntityEvents[clientId]);

export const selectLoadingClientSummary = (clientId: string) =>
  createSelector(selectStatisticsState, (state) => state.loadingClientSummary[clientId] ?? false);

export const selectLoadingClientChatIo = (clientId: string) =>
  createSelector(selectStatisticsState, (state) => state.loadingClientChatIo[clientId] ?? false);

export const selectLoadingClientFilterDrops = (clientId: string) =>
  createSelector(selectStatisticsState, (state) => state.loadingClientFilterDrops[clientId] ?? false);

export const selectLoadingClientFilterFlags = (clientId: string) =>
  createSelector(selectStatisticsState, (state) => state.loadingClientFilterFlags[clientId] ?? false);

export const selectLoadingClientEntityEvents = (clientId: string) =>
  createSelector(selectStatisticsState, (state) => state.loadingClientEntityEvents[clientId] ?? false);

// Aggregate selectors
export const selectSummary = createSelector(selectStatisticsState, (state) => state.summary);

export const selectChatIo = createSelector(selectStatisticsState, (state) => state.chatIo);

export const selectFilterDrops = createSelector(selectStatisticsState, (state) => state.filterDrops);

export const selectFilterFlags = createSelector(selectStatisticsState, (state) => state.filterFlags);

export const selectEntityEvents = createSelector(selectStatisticsState, (state) => state.entityEvents);

export const selectLoadingSummary = createSelector(selectStatisticsState, (state) => state.loadingSummary);

export const selectLoadingChatIo = createSelector(selectStatisticsState, (state) => state.loadingChatIo);

export const selectLoadingFilterDrops = createSelector(selectStatisticsState, (state) => state.loadingFilterDrops);

export const selectLoadingFilterFlags = createSelector(selectStatisticsState, (state) => state.loadingFilterFlags);

export const selectLoadingEntityEvents = createSelector(selectStatisticsState, (state) => state.loadingEntityEvents);

export const selectStatisticsError = createSelector(selectStatisticsState, (state) => state.error);
