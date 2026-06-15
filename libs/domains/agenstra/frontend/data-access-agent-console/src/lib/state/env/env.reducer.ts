import { createReducer, on } from '@ngrx/store';

import {
  clearEnvironmentVariables,
  createEnvironmentVariable,
  createEnvironmentVariableFailure,
  createEnvironmentVariableSuccess,
  deleteAllEnvironmentVariables,
  deleteAllEnvironmentVariablesFailure,
  deleteAllEnvironmentVariablesSuccess,
  deleteEnvironmentVariable,
  deleteEnvironmentVariableFailure,
  deleteEnvironmentVariableSuccess,
  loadEnvironmentVariables,
  loadEnvironmentVariablesBatch,
  loadEnvironmentVariablesCount,
  loadEnvironmentVariablesCountFailure,
  loadEnvironmentVariablesCountSuccess,
  loadEnvironmentVariablesFailure,
  loadEnvironmentVariablesSuccess,
  updateEnvironmentVariable,
  updateEnvironmentVariableFailure,
  updateEnvironmentVariableSuccess,
} from './env.actions';
import type { EnvironmentVariableResponseDto } from './env.types';

export interface EnvState {
  // Environment variables keyed by clientId:agentId
  environmentVariables: Record<string, EnvironmentVariableResponseDto[]>;
  // Count keyed by clientId:agentId
  counts: Record<string, number>;
  // Loading states keyed by clientId:agentId
  loading: Record<string, boolean>;
  loadingCount: Record<string, boolean>;
  creating: Record<string, boolean>;
  updating: Record<string, boolean>;
  deleting: Record<string, boolean>;
  deletingAll: Record<string, boolean>;
  // Errors keyed by clientId:agentId or clientId:agentId:envVarId
  errors: Record<string, string | null>;
}

export const initialEnvState: EnvState = {
  environmentVariables: {},
  counts: {},
  loading: {},
  loadingCount: {},
  creating: {},
  updating: {},
  deleting: {},
  deletingAll: {},
  errors: {},
};

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

export const envReducer = createReducer(
  initialEnvState,
  // Load Environment Variables
  on(loadEnvironmentVariables, (state, { clientId, agentId }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      loading: { ...state.loading, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(loadEnvironmentVariablesSuccess, (state, { clientId, agentId, environmentVariables }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      environmentVariables: { ...state.environmentVariables, [key]: environmentVariables },
      loading: { ...state.loading, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(loadEnvironmentVariablesFailure, (state, { clientId, agentId, error }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      loading: { ...state.loading, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  // Load Environment Variables Batch (continues loading with accumulated results)
  on(loadEnvironmentVariablesBatch, (state, { clientId, agentId }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      loading: { ...state.loading, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  // Load Environment Variables Count
  on(loadEnvironmentVariablesCount, (state, { clientId, agentId }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      loadingCount: { ...state.loadingCount, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(loadEnvironmentVariablesCountSuccess, (state, { clientId, agentId, count }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      counts: { ...state.counts, [key]: count },
      loadingCount: { ...state.loadingCount, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(loadEnvironmentVariablesCountFailure, (state, { clientId, agentId, error }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      loadingCount: { ...state.loadingCount, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  // Create Environment Variable
  on(createEnvironmentVariable, (state, { clientId, agentId }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      creating: { ...state.creating, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(createEnvironmentVariableSuccess, (state, { clientId, agentId, environmentVariable }) => {
    const key = getClientAgentKey(clientId, agentId);
    const currentVars = state.environmentVariables[key] || [];

    return {
      ...state,
      environmentVariables: {
        ...state.environmentVariables,
        [key]: [...currentVars, environmentVariable],
      },
      creating: { ...state.creating, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(createEnvironmentVariableFailure, (state, { clientId, agentId, error }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      creating: { ...state.creating, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  // Update Environment Variable
  on(updateEnvironmentVariable, (state, { clientId, agentId, envVarId }) => {
    const envVarKey = getEnvVarKey(clientId, agentId, envVarId);

    return {
      ...state,
      updating: { ...state.updating, [envVarKey]: true },
      errors: { ...state.errors, [envVarKey]: null },
    };
  }),
  on(updateEnvironmentVariableSuccess, (state, { clientId, agentId, environmentVariable }) => {
    const key = getClientAgentKey(clientId, agentId);
    const envVarKey = getEnvVarKey(clientId, agentId, environmentVariable.id);
    const currentVars = state.environmentVariables[key] || [];
    const updatedVars = currentVars.map((v) => (v.id === environmentVariable.id ? environmentVariable : v));

    return {
      ...state,
      environmentVariables: {
        ...state.environmentVariables,
        [key]: updatedVars,
      },
      updating: { ...state.updating, [envVarKey]: false },
      errors: { ...state.errors, [envVarKey]: null },
    };
  }),
  on(updateEnvironmentVariableFailure, (state, { clientId, agentId, envVarId, error }) => {
    const envVarKey = getEnvVarKey(clientId, agentId, envVarId);

    return {
      ...state,
      updating: { ...state.updating, [envVarKey]: false },
      errors: { ...state.errors, [envVarKey]: error },
    };
  }),
  // Delete Environment Variable
  on(deleteEnvironmentVariable, (state, { clientId, agentId, envVarId }) => {
    const envVarKey = getEnvVarKey(clientId, agentId, envVarId);

    return {
      ...state,
      deleting: { ...state.deleting, [envVarKey]: true },
      errors: { ...state.errors, [envVarKey]: null },
    };
  }),
  on(deleteEnvironmentVariableSuccess, (state, { clientId, agentId, envVarId }) => {
    const key = getClientAgentKey(clientId, agentId);
    const envVarKey = getEnvVarKey(clientId, agentId, envVarId);
    const currentVars = state.environmentVariables[key] || [];
    const updatedVars = currentVars.filter((v) => v.id !== envVarId);

    return {
      ...state,
      environmentVariables: {
        ...state.environmentVariables,
        [key]: updatedVars,
      },
      deleting: { ...state.deleting, [envVarKey]: false },
      errors: { ...state.errors, [envVarKey]: null },
    };
  }),
  on(deleteEnvironmentVariableFailure, (state, { clientId, agentId, envVarId, error }) => {
    const envVarKey = getEnvVarKey(clientId, agentId, envVarId);

    return {
      ...state,
      deleting: { ...state.deleting, [envVarKey]: false },
      errors: { ...state.errors, [envVarKey]: error },
    };
  }),
  // Delete All Environment Variables
  on(deleteAllEnvironmentVariables, (state, { clientId, agentId }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      deletingAll: { ...state.deletingAll, [key]: true },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(deleteAllEnvironmentVariablesSuccess, (state, { clientId, agentId }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      environmentVariables: {
        ...state.environmentVariables,
        [key]: [],
      },
      counts: {
        ...state.counts,
        [key]: 0,
      },
      deletingAll: { ...state.deletingAll, [key]: false },
      errors: { ...state.errors, [key]: null },
    };
  }),
  on(deleteAllEnvironmentVariablesFailure, (state, { clientId, agentId, error }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      deletingAll: { ...state.deletingAll, [key]: false },
      errors: { ...state.errors, [key]: error },
    };
  }),
  // Clear Environment Variables
  on(clearEnvironmentVariables, (state, { clientId, agentId }) => {
    const key = getClientAgentKey(clientId, agentId);
    const { [key]: _, ...environmentVariables } = state.environmentVariables;
    const { [key]: __, ...counts } = state.counts;

    return {
      ...state,
      environmentVariables,
      counts,
    };
  }),
);
