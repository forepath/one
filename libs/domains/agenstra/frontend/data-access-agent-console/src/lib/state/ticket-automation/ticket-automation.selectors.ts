import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { TicketAutomationState } from './ticket-automation.reducer';

export const selectTicketAutomationState = createFeatureSelector<TicketAutomationState>('ticketAutomation');

export const selectTicketAutomationActiveTicketId = createSelector(
  selectTicketAutomationState,
  (s) => s.activeTicketId,
);

export const selectTicketAutomationConfig = createSelector(selectTicketAutomationState, (s) => s.config);

export const selectTicketAutomationRuns = createSelector(selectTicketAutomationState, (s) => s.runs);

export const selectTicketAutomationRunCacheByRunId = createSelector(
  selectTicketAutomationState,
  (s) => s.runCacheByRunId,
);

export const selectTicketAutomationRunDetail = createSelector(selectTicketAutomationState, (s) => s.runDetail);

export const selectTicketAutomationLoadingConfig = createSelector(selectTicketAutomationState, (s) => s.loadingConfig);

export const selectTicketAutomationLoadingRuns = createSelector(selectTicketAutomationState, (s) => s.loadingRuns);

export const selectTicketAutomationLoadingRunDetail = createSelector(
  selectTicketAutomationState,
  (s) => s.loadingRunDetail,
);

export const selectTicketAutomationSaving = createSelector(selectTicketAutomationState, (s) => s.saving);

export const selectTicketAutomationError = createSelector(selectTicketAutomationState, (s) => s.error);
