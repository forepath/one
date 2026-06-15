import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ClientAgentAutonomyState } from './client-agent-autonomy.reducer';

export const selectClientAgentAutonomyState = createFeatureSelector<ClientAgentAutonomyState>('clientAgentAutonomy');

export const selectClientAgentAutonomyContext = createSelector(selectClientAgentAutonomyState, (s) => ({
  clientId: s.clientId,
  agentId: s.agentId,
}));

export const selectClientAgentAutonomy = createSelector(selectClientAgentAutonomyState, (s) => s.autonomy);

export const selectClientAgentAutonomyLoading = createSelector(selectClientAgentAutonomyState, (s) => s.loading);

export const selectClientAgentAutonomySaving = createSelector(selectClientAgentAutonomyState, (s) => s.saving);

export const selectClientAgentAutonomyError = createSelector(selectClientAgentAutonomyState, (s) => s.error);
