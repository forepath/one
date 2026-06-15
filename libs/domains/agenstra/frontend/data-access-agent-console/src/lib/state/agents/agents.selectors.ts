import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AgentsState } from './agents.reducer';

export const selectAgentsState = createFeatureSelector<AgentsState>('agents');

// Base selectors for the entire agents state
export const selectAgentsEntities = createSelector(selectAgentsState, (state) => state.entities);

export const selectSelectedAgents = createSelector(selectAgentsState, (state) => state.selectedAgents);

export const selectAgentsLoading = createSelector(selectAgentsState, (state) => state.loading);

export const selectAgentsLoadingAgent = createSelector(selectAgentsState, (state) => state.loadingAgent);

export const selectAgentsCreating = createSelector(selectAgentsState, (state) => state.creating);

export const selectAgentsUpdating = createSelector(selectAgentsState, (state) => state.updating);

export const selectAgentsDeleting = createSelector(selectAgentsState, (state) => state.deleting);

export const selectAgentsStarting = createSelector(selectAgentsState, (state) => state.starting);

export const selectAgentsStopping = createSelector(selectAgentsState, (state) => state.stopping);

export const selectAgentsRestarting = createSelector(selectAgentsState, (state) => state.restarting);

export const selectAgentsErrors = createSelector(selectAgentsState, (state) => state.errors);

export const selectAgentsCommands = createSelector(selectAgentsState, (state) => state.commands);

export const selectAgentsLoadingCommands = createSelector(selectAgentsState, (state) => state.loadingCommands);

export const selectAgentsAgentModels = createSelector(selectAgentsState, (state) => state.agentModels);

export const selectAgentsLoadingAgentModels = createSelector(selectAgentsState, (state) => state.loadingAgentModels);

export const selectAgentsAgentModelsErrors = createSelector(selectAgentsState, (state) => state.agentModelsErrors);

// Client-scoped selectors (factory functions that return selectors for a specific clientId)
export const selectClientAgents = (clientId: string) =>
  createSelector(selectAgentsEntities, (entities) => entities[clientId] ?? []);

export const selectSelectedClientAgent = (clientId: string) =>
  createSelector(selectSelectedAgents, (selectedAgents) => selectedAgents[clientId] ?? null);

export const selectClientAgentsLoading = (clientId: string) =>
  createSelector(selectAgentsLoading, (loading) => loading[clientId] ?? false);

export const selectClientAgentLoading = (clientId: string) =>
  createSelector(selectAgentsLoadingAgent, (loadingAgent) => loadingAgent[clientId] ?? false);

export const selectClientAgentsCreating = (clientId: string) =>
  createSelector(selectAgentsCreating, (creating) => creating[clientId] ?? false);

export const selectClientAgentsUpdating = (clientId: string) =>
  createSelector(selectAgentsUpdating, (updating) => updating[clientId] ?? false);

export const selectClientAgentsDeleting = (clientId: string) =>
  createSelector(selectAgentsDeleting, (deleting) => deleting[clientId] ?? false);

export const selectClientAgentsStarting = (clientId: string) =>
  createSelector(selectAgentsStarting, (starting) => starting[clientId] ?? false);

export const selectClientAgentsStopping = (clientId: string) =>
  createSelector(selectAgentsStopping, (stopping) => stopping[clientId] ?? false);

export const selectClientAgentsRestarting = (clientId: string) =>
  createSelector(selectAgentsRestarting, (restarting) => restarting[clientId] ?? false);

export const selectClientAgentsError = (clientId: string) =>
  createSelector(selectAgentsErrors, (errors) => errors[clientId] ?? null);

// Combined loading selector for a specific client (true if any operation is loading)
export const selectClientAgentsLoadingAny = (clientId: string) =>
  createSelector(
    selectClientAgentsLoading(clientId),
    selectClientAgentLoading(clientId),
    selectClientAgentsCreating(clientId),
    selectClientAgentsUpdating(clientId),
    selectClientAgentsDeleting(clientId),
    selectClientAgentsStarting(clientId),
    selectClientAgentsStopping(clientId),
    selectClientAgentsRestarting(clientId),
    (loading, loadingAgent, creating, updating, deleting, starting, stopping, restarting) =>
      loading || loadingAgent || creating || updating || deleting || starting || stopping || restarting,
  );

// Derived selectors for a specific client
export const selectClientAgentsCount = (clientId: string) =>
  createSelector(selectClientAgents(clientId), (agents) => agents.length);

export const selectClientAgentById = (clientId: string, agentId: string) =>
  createSelector(selectClientAgents(clientId), (agents) => agents.find((a) => a.id === agentId) ?? null);

export const selectHasClientAgents = (clientId: string) =>
  createSelector(selectClientAgents(clientId), (agents) => agents.length > 0);

// Client:Agent-scoped selectors for commands
export const selectClientAgentCommands = (clientId: string, agentId: string, agentType: string) =>
  createSelector(selectAgentsCommands, (commands) => {
    const key = `${clientId}:${agentId}`;

    return commands[key]?.[agentType] ?? [];
  });

export const selectClientAgentLoadingCommands = (clientId: string, agentId: string) =>
  createSelector(selectAgentsLoadingCommands, (loadingCommands) => {
    const key = `${clientId}:${agentId}`;

    return loadingCommands[key] ?? false;
  });

/** Cached model list for one agent (`null` if never loaded or cleared after delete). */
export const selectClientAgentModels = (clientId: string, agentId: string) =>
  createSelector(selectAgentsAgentModels, (modelsByKey) => {
    const key = `${clientId}:${agentId}`;

    return modelsByKey[key] ?? null;
  });

export const selectClientAgentModelsLoading = (clientId: string, agentId: string) =>
  createSelector(selectAgentsLoadingAgentModels, (loadingByKey) => {
    const key = `${clientId}:${agentId}`;

    return loadingByKey[key] ?? false;
  });

export const selectClientAgentModelsError = (clientId: string, agentId: string) =>
  createSelector(selectAgentsAgentModelsErrors, (errorsByKey) => {
    const key = `${clientId}:${agentId}`;

    return errorsByKey[key] ?? null;
  });
