import { createFeatureSelector, createSelector } from '@ngrx/store';

import { AGENT_HARNESS_FEATURE_KEY, type AgentHarnessState } from './agent-harness.reducer';

export const selectAgentHarnessState = createFeatureSelector<AgentHarnessState>(AGENT_HARNESS_FEATURE_KEY);

export const selectAgentConversationId = createSelector(selectAgentHarnessState, (state) => state.conversationId);

export const selectAgentMessages = createSelector(selectAgentHarnessState, (state) => state.messages);

export const selectAgentSending = createSelector(selectAgentHarnessState, (state) => state.sending);

export const selectAgentToolCalls = createSelector(selectAgentHarnessState, (state) => state.toolCalls);

export const selectAgentActivity = createSelector(selectAgentHarnessState, (state) => state.activity);

export const selectAgentLastTurn = createSelector(selectAgentHarnessState, (state) => state.lastTurn);

export const selectAgentHarnessLoading = createSelector(selectAgentHarnessState, (state) => state.loading);

export const selectAgentHarnessCreating = createSelector(selectAgentHarnessState, (state) => state.creating);

export const selectAgentHarnessError = createSelector(selectAgentHarnessState, (state) => state.error);
