import { createReducer, on } from '@ngrx/store';

import {
  clearSelectedClientAgent,
  createClientAgent,
  createClientAgentFailure,
  createClientAgentSuccess,
  deleteClientAgent,
  deleteClientAgentFailure,
  deleteClientAgentSuccess,
  loadClientAgent,
  loadClientAgentCommands,
  loadClientAgentCommandsFailure,
  loadClientAgentCommandsSuccess,
  loadClientAgentFailure,
  loadClientAgentModels,
  loadClientAgentModelsFailure,
  loadClientAgentModelsSuccess,
  loadClientAgents,
  loadClientAgentsBatch,
  loadClientAgentsFailure,
  loadClientAgentsSuccess,
  loadClientAgentSuccess,
  restartClientAgent,
  restartClientAgentFailure,
  restartClientAgentSuccess,
  startClientAgent,
  startClientAgentFailure,
  startClientAgentSuccess,
  stopClientAgent,
  stopClientAgentFailure,
  stopClientAgentSuccess,
  updateClientAgent,
  updateClientAgentFailure,
  updateClientAgentSuccess,
} from './agents.actions';
import type { AgentModelsMap, AgentResponseDto } from './agents.types';

export interface AgentsState {
  // Agents grouped by clientId
  entities: Record<string, AgentResponseDto[]>;
  // Selected agent per client
  selectedAgents: Record<string, AgentResponseDto | null>;
  // Commands per client:agent:agentType (keyed by clientId:agentId:agentType)
  commands: Record<string, Record<string, string[]>>;
  // Loading states per client
  loading: Record<string, boolean>;
  loadingAgent: Record<string, boolean>;
  loadingCommands: Record<string, boolean>;
  creating: Record<string, boolean>;
  updating: Record<string, boolean>;
  deleting: Record<string, boolean>;
  starting: Record<string, boolean>;
  stopping: Record<string, boolean>;
  restarting: Record<string, boolean>;
  // Errors per client
  errors: Record<string, string | null>;
  /** Models per `clientId:agentId` (from list models endpoint). */
  agentModels: Record<string, AgentModelsMap>;
  loadingAgentModels: Record<string, boolean>;
  agentModelsErrors: Record<string, string | null>;
}

export const initialAgentsState: AgentsState = {
  entities: {},
  selectedAgents: {},
  commands: {},
  loading: {},
  loadingAgent: {},
  loadingCommands: {},
  creating: {},
  updating: {},
  deleting: {},
  starting: {},
  stopping: {},
  restarting: {},
  errors: {},
  agentModels: {},
  loadingAgentModels: {},
  agentModelsErrors: {},
};

function getClientAgentKey(clientId: string, agentId: string): string {
  return `${clientId}:${agentId}`;
}

function updateClientState(
  state: AgentsState,
  clientId: string,
  updater: (clientState: {
    agents: AgentResponseDto[];
    selectedAgent: AgentResponseDto | null;
    loading: boolean;
    loadingAgent: boolean;
    creating: boolean;
    updating: boolean;
    deleting: boolean;
    starting: boolean;
    stopping: boolean;
    restarting: boolean;
    error: string | null;
  }) => Partial<{
    agents: AgentResponseDto[];
    selectedAgent: AgentResponseDto | null;
    loading: boolean;
    loadingAgent: boolean;
    creating: boolean;
    updating: boolean;
    deleting: boolean;
    starting: boolean;
    stopping: boolean;
    restarting: boolean;
    error: string | null;
  }>,
): AgentsState {
  const clientState = {
    agents: state.entities[clientId] || [],
    selectedAgent: state.selectedAgents[clientId] || null,
    loading: state.loading[clientId] || false,
    loadingAgent: state.loadingAgent[clientId] || false,
    creating: state.creating[clientId] || false,
    updating: state.updating[clientId] || false,
    deleting: state.deleting[clientId] || false,
    starting: state.starting[clientId] || false,
    stopping: state.stopping[clientId] || false,
    restarting: state.restarting[clientId] || false,
    error: state.errors[clientId] || null,
  };
  const updates = updater(clientState);

  return {
    ...state,
    entities: {
      ...state.entities,
      ...(updates.agents !== undefined && { [clientId]: updates.agents }),
    },
    selectedAgents: {
      ...state.selectedAgents,
      ...(updates.selectedAgent !== undefined && { [clientId]: updates.selectedAgent }),
    },
    loading: {
      ...state.loading,
      ...(updates.loading !== undefined && { [clientId]: updates.loading }),
    },
    loadingAgent: {
      ...state.loadingAgent,
      ...(updates.loadingAgent !== undefined && { [clientId]: updates.loadingAgent }),
    },
    creating: {
      ...state.creating,
      ...(updates.creating !== undefined && { [clientId]: updates.creating }),
    },
    updating: {
      ...state.updating,
      ...(updates.updating !== undefined && { [clientId]: updates.updating }),
    },
    deleting: {
      ...state.deleting,
      ...(updates.deleting !== undefined && { [clientId]: updates.deleting }),
    },
    starting: {
      ...state.starting,
      ...(updates.starting !== undefined && { [clientId]: updates.starting }),
    },
    stopping: {
      ...state.stopping,
      ...(updates.stopping !== undefined && { [clientId]: updates.stopping }),
    },
    restarting: {
      ...state.restarting,
      ...(updates.restarting !== undefined && { [clientId]: updates.restarting }),
    },
    errors: {
      ...state.errors,
      ...(updates.error !== undefined && { [clientId]: updates.error }),
    },
  };
}

export const agentsReducer = createReducer(
  initialAgentsState,
  // Load Client Agents
  on(loadClientAgents, (state, { clientId }) =>
    updateClientState(state, clientId, (clientState) => ({
      ...clientState,
      loading: true,
      error: null,
    })),
  ),
  on(loadClientAgentsBatch, (state, { clientId, accumulatedAgents }) =>
    updateClientState(state, clientId, () => ({
      agents: accumulatedAgents,
      loading: true, // Keep loading true during batch loading
      error: null,
    })),
  ),
  on(loadClientAgentsSuccess, (state, { clientId, agents }) =>
    updateClientState(state, clientId, () => ({
      agents,
      loading: false,
      error: null,
    })),
  ),
  on(loadClientAgentsFailure, (state, { clientId, error }) =>
    updateClientState(state, clientId, () => ({
      loading: false,
      error,
    })),
  ),
  // Load Client Agent by ID
  on(loadClientAgent, (state, { clientId }) =>
    updateClientState(state, clientId, (clientState) => ({
      ...clientState,
      loadingAgent: true,
      error: null,
    })),
  ),
  on(loadClientAgentSuccess, (state, { clientId, agent }) =>
    updateClientState(state, clientId, (clientState) => {
      const existingIndex = clientState.agents.findIndex((a) => a.id === agent.id);
      const agents =
        existingIndex >= 0
          ? clientState.agents.map((a) => (a.id === agent.id ? agent : a))
          : [...clientState.agents, agent];

      return {
        agents,
        selectedAgent: agent,
        loadingAgent: false,
        error: null,
      };
    }),
  ),
  on(loadClientAgentFailure, (state, { clientId, error }) =>
    updateClientState(state, clientId, () => ({
      loadingAgent: false,
      error,
    })),
  ),
  on(loadClientAgentModels, (state, { clientId, agentId }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      loadingAgentModels: { ...state.loadingAgentModels, [key]: true },
      agentModelsErrors: { ...state.agentModelsErrors, [key]: null },
    };
  }),
  on(loadClientAgentModelsSuccess, (state, { clientId, agentId, models }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      agentModels: { ...state.agentModels, [key]: models },
      loadingAgentModels: { ...state.loadingAgentModels, [key]: false },
      agentModelsErrors: { ...state.agentModelsErrors, [key]: null },
    };
  }),
  on(loadClientAgentModelsFailure, (state, { clientId, agentId, error }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      loadingAgentModels: { ...state.loadingAgentModels, [key]: false },
      agentModelsErrors: { ...state.agentModelsErrors, [key]: error },
    };
  }),
  // Create Client Agent
  on(createClientAgent, (state, { clientId }) =>
    updateClientState(state, clientId, (clientState) => ({
      ...clientState,
      creating: true,
      error: null,
    })),
  ),
  on(createClientAgentSuccess, (state, { clientId, agent }) => {
    // Strip password from CreateAgentResponseDto to store as AgentResponseDto
    const { ...agentResponse } = agent;

    return updateClientState(state, clientId, (clientState) => ({
      agents: [...clientState.agents, agentResponse],
      selectedAgent: agentResponse,
      creating: false,
      error: null,
    }));
  }),
  on(createClientAgentFailure, (state, { clientId, error }) =>
    updateClientState(state, clientId, () => ({
      creating: false,
      error,
    })),
  ),
  // Update Client Agent
  on(updateClientAgent, (state, { clientId }) =>
    updateClientState(state, clientId, (clientState) => ({
      ...clientState,
      updating: true,
      error: null,
    })),
  ),
  on(updateClientAgentSuccess, (state, { clientId, agent }) =>
    updateClientState(state, clientId, (clientState) => ({
      agents: clientState.agents.map((a) => (a.id === agent.id ? agent : a)),
      selectedAgent: clientState.selectedAgent?.id === agent.id ? agent : clientState.selectedAgent,
      updating: false,
      error: null,
    })),
  ),
  on(updateClientAgentFailure, (state, { clientId, error }) =>
    updateClientState(state, clientId, () => ({
      updating: false,
      error,
    })),
  ),
  // Delete Client Agent
  on(deleteClientAgent, (state, { clientId }) =>
    updateClientState(state, clientId, (clientState) => ({
      ...clientState,
      deleting: true,
      error: null,
    })),
  ),
  on(deleteClientAgentSuccess, (state, { clientId, agentId }) => {
    const next = updateClientState(state, clientId, (clientState) => ({
      agents: clientState.agents.filter((a) => a.id !== agentId),
      selectedAgent: clientState.selectedAgent?.id === agentId ? null : clientState.selectedAgent,
      deleting: false,
      error: null,
    }));
    const key = getClientAgentKey(clientId, agentId);
    const { [key]: _removedModels, ...agentModels } = next.agentModels;
    const { [key]: _removedLoading, ...loadingAgentModels } = next.loadingAgentModels;
    const { [key]: _removedErrors, ...agentModelsErrors } = next.agentModelsErrors;

    return { ...next, agentModels, loadingAgentModels, agentModelsErrors };
  }),
  on(deleteClientAgentFailure, (state, { clientId, error }) =>
    updateClientState(state, clientId, () => ({
      deleting: false,
      error,
    })),
  ),
  // Start Client Agent
  on(startClientAgent, (state, { clientId }) =>
    updateClientState(state, clientId, (clientState) => ({
      ...clientState,
      starting: true,
      error: null,
    })),
  ),
  on(startClientAgentSuccess, (state, { clientId, agent }) =>
    updateClientState(state, clientId, (clientState) => ({
      agents: clientState.agents.map((a) => (a.id === agent.id ? agent : a)),
      selectedAgent: clientState.selectedAgent?.id === agent.id ? agent : clientState.selectedAgent,
      starting: false,
      error: null,
    })),
  ),
  on(startClientAgentFailure, (state, { clientId, error }) =>
    updateClientState(state, clientId, () => ({
      starting: false,
      error,
    })),
  ),
  // Stop Client Agent
  on(stopClientAgent, (state, { clientId }) =>
    updateClientState(state, clientId, (clientState) => ({
      ...clientState,
      stopping: true,
      error: null,
    })),
  ),
  on(stopClientAgentSuccess, (state, { clientId, agent }) =>
    updateClientState(state, clientId, (clientState) => ({
      agents: clientState.agents.map((a) => (a.id === agent.id ? agent : a)),
      selectedAgent: clientState.selectedAgent?.id === agent.id ? agent : clientState.selectedAgent,
      stopping: false,
      error: null,
    })),
  ),
  on(stopClientAgentFailure, (state, { clientId, error }) =>
    updateClientState(state, clientId, () => ({
      stopping: false,
      error,
    })),
  ),
  // Restart Client Agent
  on(restartClientAgent, (state, { clientId }) =>
    updateClientState(state, clientId, (clientState) => ({
      ...clientState,
      restarting: true,
      error: null,
    })),
  ),
  on(restartClientAgentSuccess, (state, { clientId, agent }) =>
    updateClientState(state, clientId, (clientState) => ({
      agents: clientState.agents.map((a) => (a.id === agent.id ? agent : a)),
      selectedAgent: clientState.selectedAgent?.id === agent.id ? agent : clientState.selectedAgent,
      restarting: false,
      error: null,
    })),
  ),
  on(restartClientAgentFailure, (state, { clientId, error }) =>
    updateClientState(state, clientId, () => ({
      restarting: false,
      error,
    })),
  ),
  // Clear Selected Client Agent
  on(clearSelectedClientAgent, (state, { clientId }) =>
    updateClientState(state, clientId, (clientState) => ({
      ...clientState,
      selectedAgent: null,
    })),
  ),
  // Load Client Agent Commands
  on(loadClientAgentCommands, (state, { clientId, agentId }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      loadingCommands: { ...state.loadingCommands, [key]: true },
    };
  }),
  on(loadClientAgentCommandsSuccess, (state, { clientId, agentId, commands }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      commands: { ...state.commands, [key]: commands },
      loadingCommands: { ...state.loadingCommands, [key]: false },
    };
  }),
  on(loadClientAgentCommandsFailure, (state, { clientId, agentId }) => {
    const key = getClientAgentKey(clientId, agentId);

    return {
      ...state,
      loadingCommands: { ...state.loadingCommands, [key]: false },
    };
  }),
);
