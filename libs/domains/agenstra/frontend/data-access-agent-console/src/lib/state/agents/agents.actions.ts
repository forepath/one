import { createAction, props } from '@ngrx/store';

import type {
  AgentModelsMap,
  AgentResponseDto,
  CreateAgentDto,
  CreateAgentResponseDto,
  ListClientAgentsParams,
  UpdateAgentDto,
} from './agents.types';

// List Client Agents Actions
export const loadClientAgents = createAction(
  '[Agents] Load Client Agents',
  props<{ clientId: string; params?: ListClientAgentsParams }>(),
);

export const loadClientAgentsSuccess = createAction(
  '[Agents] Load Client Agents Success',
  props<{ clientId: string; agents: AgentResponseDto[] }>(),
);

export const loadClientAgentsFailure = createAction(
  '[Agents] Load Client Agents Failure',
  props<{ clientId: string; error: string }>(),
);

export const loadClientAgentsBatch = createAction(
  '[Agents] Load Client Agents Batch',
  props<{ clientId: string; offset: number; accumulatedAgents: AgentResponseDto[] }>(),
);

// Get Client Agent by ID Actions
export const loadClientAgent = createAction(
  '[Agents] Load Client Agent',
  props<{ clientId: string; agentId: string }>(),
);

export const loadClientAgentSuccess = createAction(
  '[Agents] Load Client Agent Success',
  props<{ clientId: string; agent: AgentResponseDto }>(),
);

export const loadClientAgentFailure = createAction(
  '[Agents] Load Client Agent Failure',
  props<{ clientId: string; error: string }>(),
);

// List models for a client agent (proxied)
export const loadClientAgentModels = createAction(
  '[Agents] Load Client Agent Models',
  props<{ clientId: string; agentId: string }>(),
);

export const loadClientAgentModelsSuccess = createAction(
  '[Agents] Load Client Agent Models Success',
  props<{ clientId: string; agentId: string; models: AgentModelsMap }>(),
);

export const loadClientAgentModelsFailure = createAction(
  '[Agents] Load Client Agent Models Failure',
  props<{ clientId: string; agentId: string; error: string }>(),
);

// Create Client Agent Actions
export const createClientAgent = createAction(
  '[Agents] Create Client Agent',
  props<{ clientId: string; agent: CreateAgentDto }>(),
);

export const createClientAgentSuccess = createAction(
  '[Agents] Create Client Agent Success',
  props<{ clientId: string; agent: CreateAgentResponseDto }>(),
);

export const createClientAgentFailure = createAction(
  '[Agents] Create Client Agent Failure',
  props<{ clientId: string; error: string }>(),
);

// Update Client Agent Actions
export const updateClientAgent = createAction(
  '[Agents] Update Client Agent',
  props<{ clientId: string; agentId: string; agent: UpdateAgentDto }>(),
);

export const updateClientAgentSuccess = createAction(
  '[Agents] Update Client Agent Success',
  props<{ clientId: string; agent: AgentResponseDto }>(),
);

export const updateClientAgentFailure = createAction(
  '[Agents] Update Client Agent Failure',
  props<{ clientId: string; error: string }>(),
);

// Delete Client Agent Actions
export const deleteClientAgent = createAction(
  '[Agents] Delete Client Agent',
  props<{ clientId: string; agentId: string }>(),
);

export const deleteClientAgentSuccess = createAction(
  '[Agents] Delete Client Agent Success',
  props<{ clientId: string; agentId: string }>(),
);

export const deleteClientAgentFailure = createAction(
  '[Agents] Delete Client Agent Failure',
  props<{ clientId: string; error: string }>(),
);

// Start Client Agent Actions
export const startClientAgent = createAction(
  '[Agents] Start Client Agent',
  props<{ clientId: string; agentId: string }>(),
);

export const startClientAgentSuccess = createAction(
  '[Agents] Start Client Agent Success',
  props<{ clientId: string; agent: AgentResponseDto }>(),
);

export const startClientAgentFailure = createAction(
  '[Agents] Start Client Agent Failure',
  props<{ clientId: string; error: string }>(),
);

// Stop Client Agent Actions
export const stopClientAgent = createAction(
  '[Agents] Stop Client Agent',
  props<{ clientId: string; agentId: string }>(),
);

export const stopClientAgentSuccess = createAction(
  '[Agents] Stop Client Agent Success',
  props<{ clientId: string; agent: AgentResponseDto }>(),
);

export const stopClientAgentFailure = createAction(
  '[Agents] Stop Client Agent Failure',
  props<{ clientId: string; error: string }>(),
);

// Restart Client Agent Actions
export const restartClientAgent = createAction(
  '[Agents] Restart Client Agent',
  props<{ clientId: string; agentId: string }>(),
);

export const restartClientAgentSuccess = createAction(
  '[Agents] Restart Client Agent Success',
  props<{ clientId: string; agent: AgentResponseDto }>(),
);

export const restartClientAgentFailure = createAction(
  '[Agents] Restart Client Agent Failure',
  props<{ clientId: string; error: string }>(),
);

// Clear Selected Agent Actions
export const clearSelectedClientAgent = createAction(
  '[Agents] Clear Selected Client Agent',
  props<{ clientId: string }>(),
);

// Load Client Agent Commands Actions
export const loadClientAgentCommands = createAction(
  '[Agents] Load Client Agent Commands',
  props<{ clientId: string; agentId: string }>(),
);

export const loadClientAgentCommandsSuccess = createAction(
  '[Agents] Load Client Agent Commands Success',
  props<{ clientId: string; agentId: string; commands: { [agentType: string]: string[] } }>(),
);

export const loadClientAgentCommandsFailure = createAction(
  '[Agents] Load Client Agent Commands Failure',
  props<{ clientId: string; agentId: string }>(),
);
