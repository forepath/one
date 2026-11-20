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
  loadClientAgentsFailure,
  loadClientAgentsRailPage,
  loadClientAgentsRailPageFailure,
  loadClientAgentsRailPageSuccess,
  loadClientAgentsSuccess,
  loadClientAgentSuccess,
  loadMoreClientAgents,
  loadMoreClientAgentsFailure,
  loadMoreClientAgentsSuccess,
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
import type { AgentModelsMap, AgentResponseDto, AgentSlashCommand, ClientAgentsRailPageQuery } from './agents.types';

/**
 * Replace-page slice of the environments rail (one workspace at a time): only the rows of the current server page are
 * held (each page / size / search / workspace change replaces them), independent of the append-style `entities`.
 */
export interface AgentsRailPageState {
  /** Workspace the listed page belongs to; `null` until the rail requested a page. */
  clientId: string | null;
  /** Rows of the current page (at most `query.limit`). */
  rows: AgentResponseDto[];
  /** Query of the listed page (reloaded after creates / deletes). */
  query: ClientAgentsRailPageQuery | null;
  /** Server paging without a total: the page was requested with one extra row to know whether a next one exists. */
  hasNext: boolean;
  loading: boolean;
  error: string | null;
}

export const initialAgentsRailPageState: AgentsRailPageState = {
  clientId: null,
  rows: [],
  query: null,
  hasNext: false,
  loading: false,
  error: null,
};

/** Replaces a rail row of the listed workspace by id (rows not on the current page are left alone). */
function patchRailRow(state: AgentsState, clientId: string, agent: AgentResponseDto): AgentsState {
  const railPage = state.railPage;

  return railPage.clientId === clientId && railPage.rows.some((a) => a.id === agent.id)
    ? { ...state, railPage: { ...railPage, rows: railPage.rows.map((a) => (a.id === agent.id ? agent : a)) } }
    : state;
}

function removeRailRow(state: AgentsState, clientId: string, agentId: string): AgentsState {
  const railPage = state.railPage;

  return railPage.clientId === clientId && railPage.rows.some((a) => a.id === agentId)
    ? { ...state, railPage: { ...railPage, rows: railPage.rows.filter((a) => a.id !== agentId) } }
    : state;
}

export interface AgentsState {
  // Agents grouped by clientId
  entities: Record<string, AgentResponseDto[]>;
  // Selected agent per client
  selectedAgents: Record<string, AgentResponseDto | null>;
  // Slash commands per client:agent (keyed by clientId:agentId)
  commands: Record<string, AgentSlashCommand[]>;
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
  /** Error of the last environment list load per client (e.g. workspace not reachable). */
  listErrors: Record<string, string | null>;
  hasMore: Record<string, boolean>;
  nextOffset: Record<string, number>;
  search: Record<string, string | null>;
  appendLoading: Record<string, boolean>;
  appendError: Record<string, string | null>;
  /** Models per `clientId:agentId` (from list models endpoint). */
  agentModels: Record<string, AgentModelsMap>;
  loadingAgentModels: Record<string, boolean>;
  agentModelsErrors: Record<string, string | null>;
  /** Environments rail of the agent console (replace-page server paging). */
  railPage: AgentsRailPageState;
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
  listErrors: {},
  hasMore: {},
  nextOffset: {},
  search: {},
  appendLoading: {},
  appendError: {},
  agentModels: {},
  loadingAgentModels: {},
  agentModelsErrors: {},
  railPage: initialAgentsRailPageState,
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
  on(loadClientAgents, (state, { clientId, params }) => ({
    ...updateClientState(state, clientId, (clientState) => ({
      ...clientState,
      agents: [],
      loading: true,
      error: null,
    })),
    hasMore: { ...state.hasMore, [clientId]: false },
    nextOffset: { ...state.nextOffset, [clientId]: 0 },
    search: { ...state.search, [clientId]: params?.search?.trim() ? params.search.trim() : null },
    appendLoading: { ...state.appendLoading, [clientId]: false },
    appendError: { ...state.appendError, [clientId]: null },
    listErrors: { ...state.listErrors, [clientId]: null },
  })),
  on(loadClientAgentsSuccess, (state, { clientId, agents, hasMore, nextOffset }) => ({
    ...updateClientState(state, clientId, () => ({
      agents,
      loading: false,
      error: null,
    })),
    hasMore: { ...state.hasMore, [clientId]: hasMore },
    nextOffset: { ...state.nextOffset, [clientId]: nextOffset },
    appendLoading: { ...state.appendLoading, [clientId]: false },
    appendError: { ...state.appendError, [clientId]: null },
    listErrors: { ...state.listErrors, [clientId]: null },
  })),
  on(loadClientAgentsFailure, (state, { clientId, error }) => ({
    ...updateClientState(state, clientId, () => ({
      loading: false,
      error,
    })),
    listErrors: { ...state.listErrors, [clientId]: error },
    hasMore: { ...state.hasMore, [clientId]: false },
    appendLoading: { ...state.appendLoading, [clientId]: false },
  })),
  // Only mark a batch as loading when one can start; the effect sees this state after the reducer ran.
  on(loadMoreClientAgents, (state, { clientId }) =>
    state.hasMore[clientId] && !state.loading[clientId] && !state.appendLoading[clientId]
      ? {
          ...state,
          appendLoading: { ...state.appendLoading, [clientId]: true },
          appendError: { ...state.appendError, [clientId]: null },
        }
      : state,
  ),
  on(loadMoreClientAgentsSuccess, (state, { clientId, agents, hasMore, nextOffset }) => ({
    ...updateClientState(state, clientId, (clientState) => ({
      agents: [...clientState.agents, ...agents],
    })),
    hasMore: { ...state.hasMore, [clientId]: hasMore },
    nextOffset: { ...state.nextOffset, [clientId]: nextOffset },
    appendLoading: { ...state.appendLoading, [clientId]: false },
    appendError: { ...state.appendError, [clientId]: null },
  })),
  on(loadMoreClientAgentsFailure, (state, { clientId, error }) => ({
    ...state,
    appendLoading: { ...state.appendLoading, [clientId]: false },
    appendError: { ...state.appendError, [clientId]: error },
  })),
  // Environments rail (replace-page)
  on(loadClientAgentsRailPage, (state, { clientId, query, silent }) => {
    const sameClient = state.railPage.clientId === clientId;

    return {
      ...state,
      railPage: {
        ...state.railPage,
        clientId,
        query,
        // Rows of another workspace are never shown while the new one loads.
        rows: sameClient ? state.railPage.rows : [],
        hasNext: sameClient ? state.railPage.hasNext : false,
        loading: silent && sameClient ? state.railPage.loading : true,
        error: silent && sameClient ? state.railPage.error : null,
      },
    };
  }),
  on(loadClientAgentsRailPageSuccess, (state, { clientId, agents, hasNext }) =>
    state.railPage.clientId === clientId
      ? { ...state, railPage: { ...state.railPage, rows: agents, hasNext, loading: false, error: null } }
      : state,
  ),
  on(loadClientAgentsRailPageFailure, (state, { clientId, error }) =>
    state.railPage.clientId === clientId
      ? { ...state, railPage: { ...state.railPage, rows: [], hasNext: false, loading: false, error } }
      : state,
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
    patchRailRow(
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
      clientId,
      agent,
    ),
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
    patchRailRow(
      updateClientState(state, clientId, (clientState) => ({
        agents: clientState.agents.map((a) => (a.id === agent.id ? agent : a)),
        selectedAgent: clientState.selectedAgent?.id === agent.id ? agent : clientState.selectedAgent,
        updating: false,
        error: null,
      })),
      clientId,
      agent,
    ),
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

    return removeRailRow({ ...next, agentModels, loadingAgentModels, agentModelsErrors }, clientId, agentId);
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
    patchRailRow(
      updateClientState(state, clientId, (clientState) => ({
        agents: clientState.agents.map((a) => (a.id === agent.id ? agent : a)),
        selectedAgent: clientState.selectedAgent?.id === agent.id ? agent : clientState.selectedAgent,
        starting: false,
        error: null,
      })),
      clientId,
      agent,
    ),
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
    patchRailRow(
      updateClientState(state, clientId, (clientState) => ({
        agents: clientState.agents.map((a) => (a.id === agent.id ? agent : a)),
        selectedAgent: clientState.selectedAgent?.id === agent.id ? agent : clientState.selectedAgent,
        stopping: false,
        error: null,
      })),
      clientId,
      agent,
    ),
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
    patchRailRow(
      updateClientState(state, clientId, (clientState) => ({
        agents: clientState.agents.map((a) => (a.id === agent.id ? agent : a)),
        selectedAgent: clientState.selectedAgent?.id === agent.id ? agent : clientState.selectedAgent,
        restarting: false,
        error: null,
      })),
      clientId,
      agent,
    ),
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
