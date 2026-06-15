import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { EnvState } from './env.reducer';

export const selectEnvState = createFeatureSelector<EnvState>('env');

// Base selectors
export const selectEnvironmentVariables = createSelector(selectEnvState, (state) => state.environmentVariables);
export const selectEnvCounts = createSelector(selectEnvState, (state) => state.counts);
export const selectEnvLoading = createSelector(selectEnvState, (state) => state.loading);
export const selectEnvLoadingCount = createSelector(selectEnvState, (state) => state.loadingCount);
export const selectEnvCreating = createSelector(selectEnvState, (state) => state.creating);
export const selectEnvUpdating = createSelector(selectEnvState, (state) => state.updating);
export const selectEnvDeleting = createSelector(selectEnvState, (state) => state.deleting);
export const selectEnvDeletingAll = createSelector(selectEnvState, (state) => state.deletingAll);
export const selectEnvErrors = createSelector(selectEnvState, (state) => state.errors);

/**
 * Generate a key for client/agent operations (clientId:agentId)
 */
function getClientAgentKey(clientId: string, agentId: string): string {
  return `${clientId}:${agentId}`;
}

/**
 * Generate a key for environment variable operations (clientId:agentId:envVarId)
 */
function getEnvVarKey(clientId: string, agentId: string, envVarId: string): string {
  return `${clientId}:${agentId}:${envVarId}`;
}

// Environment variables selectors (factory functions)
export const selectEnvironmentVariablesForAgent = (clientId: string, agentId: string) =>
  createSelector(selectEnvironmentVariables, (environmentVariables) => {
    const key = getClientAgentKey(clientId, agentId);

    return environmentVariables[key] ?? null;
  });

export const selectEnvironmentVariablesCount = (clientId: string, agentId: string) =>
  createSelector(selectEnvCounts, (counts) => {
    const key = getClientAgentKey(clientId, agentId);

    return counts[key] ?? null;
  });

export const selectIsLoadingEnvironmentVariables = (clientId: string, agentId: string) =>
  createSelector(selectEnvLoading, (loading) => {
    const key = getClientAgentKey(clientId, agentId);

    return loading[key] ?? false;
  });

export const selectIsLoadingEnvironmentVariablesCount = (clientId: string, agentId: string) =>
  createSelector(selectEnvLoadingCount, (loadingCount) => {
    const key = getClientAgentKey(clientId, agentId);

    return loadingCount[key] ?? false;
  });

export const selectIsCreatingEnvironmentVariable = (clientId: string, agentId: string) =>
  createSelector(selectEnvCreating, (creating) => {
    const key = getClientAgentKey(clientId, agentId);

    return creating[key] ?? false;
  });

export const selectIsUpdatingEnvironmentVariable = (clientId: string, agentId: string, envVarId: string) =>
  createSelector(selectEnvUpdating, (updating) => {
    const envVarKey = getEnvVarKey(clientId, agentId, envVarId);

    return updating[envVarKey] ?? false;
  });

export const selectIsDeletingEnvironmentVariable = (clientId: string, agentId: string, envVarId: string) =>
  createSelector(selectEnvDeleting, (deleting) => {
    const envVarKey = getEnvVarKey(clientId, agentId, envVarId);

    return deleting[envVarKey] ?? false;
  });

export const selectIsDeletingAllEnvironmentVariables = (clientId: string, agentId: string) =>
  createSelector(selectEnvDeletingAll, (deletingAll) => {
    const key = getClientAgentKey(clientId, agentId);

    return deletingAll[key] ?? false;
  });

// Error selectors (factory functions)
export const selectEnvError = (clientId: string, agentId: string) =>
  createSelector(selectEnvErrors, (errors) => {
    const key = getClientAgentKey(clientId, agentId);

    return errors[key] ?? null;
  });

export const selectEnvVarError = (clientId: string, agentId: string, envVarId: string) =>
  createSelector(selectEnvErrors, (errors) => {
    const envVarKey = getEnvVarKey(clientId, agentId, envVarId);

    return errors[envVarKey] ?? null;
  });

// Combined loading selector for environment variables operations
export const selectEnvironmentVariablesOperationLoading = (clientId: string, agentId: string) =>
  createSelector(
    selectIsLoadingEnvironmentVariables(clientId, agentId),
    selectIsCreatingEnvironmentVariable(clientId, agentId),
    selectIsDeletingAllEnvironmentVariables(clientId, agentId),
    (loading, creating, deletingAll) => loading || creating || deletingAll,
  );

// Combined loading selector for a specific environment variable operation
export const selectEnvironmentVariableOperationLoading = (clientId: string, agentId: string, envVarId: string) =>
  createSelector(
    selectIsUpdatingEnvironmentVariable(clientId, agentId, envVarId),
    selectIsDeletingEnvironmentVariable(clientId, agentId, envVarId),
    (updating, deleting) => updating || deleting,
  );
