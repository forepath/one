import { createAction, props } from '@ngrx/store';

import type {
  CreateEnvironmentVariableDto,
  EnvironmentVariableResponseDto,
  ListEnvironmentVariablesParams,
  UpdateEnvironmentVariableDto,
} from './env.types';

// List Environment Variables Actions
export const loadEnvironmentVariables = createAction(
  '[Env] Load Environment Variables',
  props<{ clientId: string; agentId: string; params?: ListEnvironmentVariablesParams }>(),
);

export const loadEnvironmentVariablesSuccess = createAction(
  '[Env] Load Environment Variables Success',
  props<{ clientId: string; agentId: string; environmentVariables: EnvironmentVariableResponseDto[] }>(),
);

export const loadEnvironmentVariablesFailure = createAction(
  '[Env] Load Environment Variables Failure',
  props<{ clientId: string; agentId: string; error: string }>(),
);

export const loadEnvironmentVariablesBatch = createAction(
  '[Env] Load Environment Variables Batch',
  props<{ clientId: string; agentId: string; offset: number; accumulatedEnvVars: EnvironmentVariableResponseDto[] }>(),
);

// Count Environment Variables Actions
export const loadEnvironmentVariablesCount = createAction(
  '[Env] Load Environment Variables Count',
  props<{ clientId: string; agentId: string }>(),
);

export const loadEnvironmentVariablesCountSuccess = createAction(
  '[Env] Load Environment Variables Count Success',
  props<{ clientId: string; agentId: string; count: number }>(),
);

export const loadEnvironmentVariablesCountFailure = createAction(
  '[Env] Load Environment Variables Count Failure',
  props<{ clientId: string; agentId: string; error: string }>(),
);

// Create Environment Variable Actions
export const createEnvironmentVariable = createAction(
  '[Env] Create Environment Variable',
  props<{ clientId: string; agentId: string; createDto: CreateEnvironmentVariableDto }>(),
);

export const createEnvironmentVariableSuccess = createAction(
  '[Env] Create Environment Variable Success',
  props<{ clientId: string; agentId: string; environmentVariable: EnvironmentVariableResponseDto }>(),
);

export const createEnvironmentVariableFailure = createAction(
  '[Env] Create Environment Variable Failure',
  props<{ clientId: string; agentId: string; error: string }>(),
);

// Update Environment Variable Actions
export const updateEnvironmentVariable = createAction(
  '[Env] Update Environment Variable',
  props<{ clientId: string; agentId: string; envVarId: string; updateDto: UpdateEnvironmentVariableDto }>(),
);

export const updateEnvironmentVariableSuccess = createAction(
  '[Env] Update Environment Variable Success',
  props<{ clientId: string; agentId: string; environmentVariable: EnvironmentVariableResponseDto }>(),
);

export const updateEnvironmentVariableFailure = createAction(
  '[Env] Update Environment Variable Failure',
  props<{ clientId: string; agentId: string; envVarId: string; error: string }>(),
);

// Delete Environment Variable Actions
export const deleteEnvironmentVariable = createAction(
  '[Env] Delete Environment Variable',
  props<{ clientId: string; agentId: string; envVarId: string }>(),
);

export const deleteEnvironmentVariableSuccess = createAction(
  '[Env] Delete Environment Variable Success',
  props<{ clientId: string; agentId: string; envVarId: string }>(),
);

export const deleteEnvironmentVariableFailure = createAction(
  '[Env] Delete Environment Variable Failure',
  props<{ clientId: string; agentId: string; envVarId: string; error: string }>(),
);

// Delete All Environment Variables Actions
export const deleteAllEnvironmentVariables = createAction(
  '[Env] Delete All Environment Variables',
  props<{ clientId: string; agentId: string }>(),
);

export const deleteAllEnvironmentVariablesSuccess = createAction(
  '[Env] Delete All Environment Variables Success',
  props<{ clientId: string; agentId: string; deletedCount: number }>(),
);

export const deleteAllEnvironmentVariablesFailure = createAction(
  '[Env] Delete All Environment Variables Failure',
  props<{ clientId: string; agentId: string; error: string }>(),
);

// Clear Environment Variables Actions
export const clearEnvironmentVariables = createAction(
  '[Env] Clear Environment Variables',
  props<{ clientId: string; agentId: string }>(),
);
