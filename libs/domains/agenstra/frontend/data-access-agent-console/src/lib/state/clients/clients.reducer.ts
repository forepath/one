import { createReducer, on } from '@ngrx/store';

import { loadClientAgentsSuccess } from '../agents/agents.actions';

import {
  addClientUser,
  addClientUserFailure,
  addClientUserSuccess,
  clearActiveClient,
  createClient,
  createClientFailure,
  createClientSuccess,
  deleteClient,
  deleteClientFailure,
  deleteClientSuccess,
  deleteProvisionedServer,
  deleteProvisionedServerFailure,
  deleteProvisionedServerSuccess,
  loadClient,
  loadClientFailure,
  loadClients,
  loadClientsFailure,
  loadClientsRailPage,
  loadClientsRailPageFailure,
  loadClientsRailPageSuccess,
  loadClientsSuccess,
  pingClientFailure,
  pingClientSuccess,
  pingClients,
  loadClientSuccess,
  loadMoreClients,
  loadMoreClientsFailure,
  loadMoreClientsSuccess,
  loadClientUsers,
  loadClientUsersFailure,
  loadClientUsersSuccess,
  loadProvisioningProviders,
  loadProvisioningProvidersFailure,
  loadProvisioningProvidersSuccess,
  loadServerInfo,
  loadServerInfoFailure,
  loadServerInfoSuccess,
  loadServerTypes,
  loadServerTypesFailure,
  loadServerTypesSuccess,
  loadLocations,
  loadLocationsFailure,
  loadLocationsSuccess,
  provisionServer,
  provisionServerFailure,
  provisionServerSuccess,
  refreshClientIsolation,
  refreshClientIsolationFailure,
  refreshClientIsolationSuccess,
  removeClientUser,
  removeClientUserFailure,
  removeClientUserSuccess,
  resolveActiveClientSuccess,
  setActiveClient,
  setActiveClientFailure,
  setActiveClientSuccess,
  updateClient,
  updateClientFailure,
  updateClientSuccess,
} from './clients.actions';
import type {
  ClientResponseDto,
  ClientUserResponseDto,
  ClientsRailPageQuery,
  ProvisioningProviderInfo,
  ProviderLocation,
  ServerInfo,
  ServerType,
} from './clients.types';

/**
 * Replace-page slice of the workspaces rail: only the rows of the current server page are held (each page / size /
 * search change replaces them), independent of the append-style `entities` other consumers page through.
 */
export interface ClientsRailPageState {
  /** Rows of the current page (at most `query.limit`). */
  rows: ClientResponseDto[];
  /** Query of the listed page (reloaded after creates / deletes); `null` until the rail requested a page. */
  query: ClientsRailPageQuery | null;
  /** Server paging without a total: the page was requested with one extra row to know whether a next one exists. */
  hasNext: boolean;
  loading: boolean;
  error: string | null;
}

export const initialClientsRailPageState: ClientsRailPageState = {
  rows: [],
  query: null,
  hasNext: false,
  loading: false,
  error: null,
};

/** Replaces a rail row by id (rows not on the current page are left alone). */
function patchRailRow(
  railPage: ClientsRailPageState,
  id: string,
  patch: (client: ClientResponseDto) => ClientResponseDto,
): ClientsRailPageState {
  return railPage.rows.some((c) => c.id === id)
    ? { ...railPage, rows: railPage.rows.map((c) => (c.id === id ? patch(c) : c)) }
    : railPage;
}

function removeRailRow(railPage: ClientsRailPageState, id: string): ClientsRailPageState {
  return railPage.rows.some((c) => c.id === id)
    ? { ...railPage, rows: railPage.rows.filter((c) => c.id !== id) }
    : railPage;
}

export interface ClientsState {
  entities: ClientResponseDto[];
  selectedClient: ClientResponseDto | null;
  activeClientId: string | null;
  loading: boolean;
  loadingClient: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  error: string | null;
  hasMore: boolean;
  nextOffset: number;
  appendLoading: boolean;
  appendError: string | null;
  search: string | null;
  // Provisioning state
  provisioningProviders: ProvisioningProviderInfo[];
  loadingProviders: boolean;
  serverTypes: Record<string, ServerType[]>; // keyed by providerType
  loadingServerTypes: Record<string, boolean>; // keyed by providerType
  locations: Record<string, ProviderLocation[]>; // keyed by providerType
  loadingLocations: Record<string, boolean>; // keyed by providerType
  provisioning: boolean;
  serverInfo: Record<string, ServerInfo>; // keyed by clientId
  loadingServerInfo: Record<string, boolean>; // keyed by clientId
  deletingProvisionedServer: Record<string, boolean>; // keyed by clientId
  // Client user management (per-client permissions)
  clientUsers: Record<string, ClientUserResponseDto[]>; // keyed by clientId
  loadingClientUsers: Record<string, boolean>; // keyed by clientId
  addingClientUser: Record<string, boolean>; // keyed by clientId
  removingClientUser: Record<string, boolean>; // keyed by relationshipId
  // Container isolation (merged into the client entities on success)
  refreshingIsolation: Record<string, boolean>; // keyed by clientId
  isolationErrors: Record<string, string | null>; // keyed by clientId
  /**
   * Workspace reachability from the one-time list ping, keyed by clientId: `null` = pinged (pending, reachable or
   * unknown), string = why the workspace cannot be reached. Presence of a key means "already pinged".
   */
  reachabilityErrors: Record<string, string | null>;
  /** Workspaces rail of the agent console (replace-page server paging). */
  railPage: ClientsRailPageState;
}

export const initialClientsState: ClientsState = {
  entities: [],
  selectedClient: null,
  activeClientId: null,
  loading: false,
  loadingClient: false,
  creating: false,
  updating: false,
  deleting: false,
  error: null,
  hasMore: false,
  nextOffset: 0,
  appendLoading: false,
  appendError: null,
  search: null,
  provisioningProviders: [],
  loadingProviders: false,
  serverTypes: {},
  loadingServerTypes: {},
  locations: {},
  loadingLocations: {},
  provisioning: false,
  serverInfo: {},
  loadingServerInfo: {},
  deletingProvisionedServer: {},
  clientUsers: {},
  loadingClientUsers: {},
  addingClientUser: {},
  removingClientUser: {},
  refreshingIsolation: {},
  isolationErrors: {},
  reachabilityErrors: {},
  railPage: initialClientsRailPageState,
};

export const clientsReducer = createReducer(
  initialClientsState,
  // Load Clients
  on(loadClients, (state, { params }) => ({
    ...state,
    entities: [],
    loading: true,
    error: null,
    hasMore: false,
    nextOffset: 0,
    appendLoading: false,
    appendError: null,
    search: params?.search?.trim() ? params.search.trim() : null,
  })),
  on(loadClientsSuccess, (state, { clients, hasMore, nextOffset }) => ({
    ...state,
    entities: clients,
    loading: false,
    error: null,
    hasMore,
    nextOffset,
    appendLoading: false,
    appendError: null,
  })),
  on(loadClientsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
    hasMore: false,
    appendLoading: false,
  })),
  // Only mark a batch as loading when one can start; the effect sees this state after the reducer ran.
  on(loadMoreClients, (state) =>
    state.hasMore && !state.loading && !state.appendLoading
      ? { ...state, appendLoading: true, appendError: null }
      : state,
  ),
  on(loadMoreClientsSuccess, (state, { clients, hasMore, nextOffset }) => ({
    ...state,
    entities: [...state.entities, ...clients],
    hasMore,
    nextOffset,
    appendLoading: false,
    appendError: null,
  })),
  on(loadMoreClientsFailure, (state, { error }) => ({
    ...state,
    appendLoading: false,
    appendError: error,
  })),
  // Workspaces rail (replace-page)
  on(loadClientsRailPage, (state, { query, silent }) => ({
    ...state,
    railPage: {
      ...state.railPage,
      query,
      loading: silent ? state.railPage.loading : true,
      error: silent ? state.railPage.error : null,
    },
  })),
  on(loadClientsRailPageSuccess, (state, { clients, hasNext }) => ({
    ...state,
    railPage: { ...state.railPage, rows: clients, hasNext, loading: false, error: null },
  })),
  on(loadClientsRailPageFailure, (state, { error }) => ({
    ...state,
    railPage: { ...state.railPage, rows: [], hasNext: false, loading: false, error },
  })),
  // Load Client by ID
  on(loadClient, (state) => ({
    ...state,
    loadingClient: true,
    error: null,
  })),
  on(loadClientSuccess, (state, { client }) => {
    const existingIndex = state.entities.findIndex((c) => c.id === client.id);
    const entities =
      existingIndex >= 0 ? state.entities.map((c) => (c.id === client.id ? client : c)) : [...state.entities, client];

    return {
      ...state,
      selectedClient: client,
      entities,
      railPage: patchRailRow(state.railPage, client.id, () => client),
      loadingClient: false,
      error: null,
    };
  }),
  on(loadClientFailure, (state, { error }) => ({
    ...state,
    loadingClient: false,
    error,
  })),
  // Create Client
  on(createClient, (state) => ({
    ...state,
    creating: true,
    error: null,
  })),
  on(createClientSuccess, (state, { client }) => {
    // Strip apiKey from CreateClientResponseDto to store as ClientResponseDto
    const { ...clientResponse } = client;

    return {
      ...state,
      entities: [...state.entities, clientResponse],
      selectedClient: clientResponse,
      creating: false,
      error: null,
    };
  }),
  on(createClientFailure, (state, { error }) => ({
    ...state,
    creating: false,
    error,
  })),
  // Update Client
  on(updateClient, (state) => ({
    ...state,
    updating: true,
    error: null,
  })),
  on(updateClientSuccess, (state, { client }) => ({
    ...state,
    entities: state.entities.map((c) => (c.id === client.id ? client : c)),
    selectedClient: state.selectedClient?.id === client.id ? client : state.selectedClient,
    railPage: patchRailRow(state.railPage, client.id, () => client),
    updating: false,
    error: null,
  })),
  on(updateClientFailure, (state, { error }) => ({
    ...state,
    updating: false,
    error,
  })),
  // Delete Client
  on(deleteClient, (state) => ({
    ...state,
    deleting: true,
    error: null,
  })),
  on(deleteClientSuccess, (state, { id }) => ({
    ...state,
    reachabilityErrors: Object.fromEntries(Object.entries(state.reachabilityErrors).filter(([key]) => key !== id)),
    entities: state.entities.filter((c) => c.id !== id),
    railPage: removeRailRow(state.railPage, id),
    selectedClient: state.selectedClient?.id === id ? null : state.selectedClient,
    activeClientId: state.activeClientId === id ? null : state.activeClientId,
    deleting: false,
    error: null,
  })),
  on(deleteClientFailure, (state, { error }) => ({
    ...state,
    deleting: false,
    error,
  })),
  // Set Active Client
  on(setActiveClient, (state) => ({
    ...state,
    error: null,
  })),
  on(setActiveClientSuccess, (state, { id }) => {
    const activeClient =
      state.entities.find((c) => c.id === id) ??
      state.railPage.rows.find((c) => c.id === id) ??
      (state.selectedClient?.id === id ? state.selectedClient : null);

    return {
      ...state,
      activeClientId: id,
      selectedClient: activeClient,
      error: null,
    };
  }),
  on(resolveActiveClientSuccess, (state, { client }) =>
    state.activeClientId === client.id
      ? {
          ...state,
          selectedClient: client,
          railPage: patchRailRow(state.railPage, client.id, () => client),
        }
      : state,
  ),
  on(setActiveClientFailure, (state, { error }) => ({
    ...state,
    error,
  })),
  // Clear Active Client
  on(clearActiveClient, (state) => ({
    ...state,
    activeClientId: null,
    error: null,
  })),
  // Provisioning Providers
  on(loadProvisioningProviders, (state) => ({
    ...state,
    loadingProviders: true,
    error: null,
  })),
  on(loadProvisioningProvidersSuccess, (state, { providers }) => ({
    ...state,
    provisioningProviders: providers,
    loadingProviders: false,
    error: null,
  })),
  on(loadProvisioningProvidersFailure, (state, { error }) => ({
    ...state,
    loadingProviders: false,
    error,
  })),
  // Server Types
  on(loadServerTypes, (state, { providerType }) => ({
    ...state,
    loadingServerTypes: { ...state.loadingServerTypes, [providerType]: true },
    error: null,
  })),
  on(loadServerTypesSuccess, (state, { providerType, serverTypes }) => ({
    ...state,
    serverTypes: { ...state.serverTypes, [providerType]: serverTypes },
    loadingServerTypes: { ...state.loadingServerTypes, [providerType]: false },
    error: null,
  })),
  on(loadServerTypesFailure, (state, { error }) => ({
    ...state,
    loadingServerTypes: Object.keys(state.loadingServerTypes).reduce(
      (acc, key) => ({ ...acc, [key]: false }),
      {} as Record<string, boolean>,
    ),
    error,
  })),
  // Locations
  on(loadLocations, (state, { providerType }) => ({
    ...state,
    loadingLocations: { ...state.loadingLocations, [providerType]: true },
    error: null,
  })),
  on(loadLocationsSuccess, (state, { providerType, locations }) => ({
    ...state,
    locations: { ...state.locations, [providerType]: locations },
    loadingLocations: { ...state.loadingLocations, [providerType]: false },
    error: null,
  })),
  on(loadLocationsFailure, (state, { error }) => ({
    ...state,
    loadingLocations: Object.keys(state.loadingLocations).reduce(
      (acc, key) => ({ ...acc, [key]: false }),
      {} as Record<string, boolean>,
    ),
    error,
  })),
  // Provision Server
  on(provisionServer, (state) => ({
    ...state,
    provisioning: true,
    error: null,
  })),
  on(provisionServerSuccess, (state, { server }) => {
    // Strip provisioning-specific fields to store as ClientResponseDto
    const { ...clientResponse } = server;

    return {
      ...state,
      entities: [...state.entities, clientResponse],
      selectedClient: clientResponse,
      provisioning: false,
      error: null,
    };
  }),
  on(provisionServerFailure, (state, { error }) => ({
    ...state,
    provisioning: false,
    error,
  })),
  // Server Info
  on(loadServerInfo, (state, { clientId }) => ({
    ...state,
    loadingServerInfo: { ...state.loadingServerInfo, [clientId]: true },
    error: null,
  })),
  on(loadServerInfoSuccess, (state, { clientId, serverInfo }) => ({
    ...state,
    serverInfo: { ...state.serverInfo, [clientId]: serverInfo },
    loadingServerInfo: { ...state.loadingServerInfo, [clientId]: false },
    error: null,
  })),
  on(loadServerInfoFailure, (state, { clientId, error }) => ({
    ...state,
    loadingServerInfo: { ...state.loadingServerInfo, [clientId]: false },
    // Only set error state if error message is not empty (404 errors are handled gracefully)
    // If error is empty (404 case), preserve existing error state; otherwise set new error
    error: error ? error : state.error,
  })),
  // Delete Provisioned Server
  on(deleteProvisionedServer, (state, { clientId }) => ({
    ...state,
    deletingProvisionedServer: { ...state.deletingProvisionedServer, [clientId]: true },
    error: null,
  })),
  on(deleteProvisionedServerSuccess, (state, { clientId }) => {
    const { [clientId]: _, ...restServerInfo } = state.serverInfo;
    const { [clientId]: __, ...restLoadingServerInfo } = state.loadingServerInfo;
    const { [clientId]: ___, ...restDeletingProvisionedServer } = state.deletingProvisionedServer;

    return {
      ...state,
      entities: state.entities.filter((c) => c.id !== clientId),
      railPage: removeRailRow(state.railPage, clientId),
      selectedClient: state.selectedClient?.id === clientId ? null : state.selectedClient,
      activeClientId: state.activeClientId === clientId ? null : state.activeClientId,
      serverInfo: restServerInfo,
      loadingServerInfo: restLoadingServerInfo,
      deletingProvisionedServer: restDeletingProvisionedServer,
      error: null,
    };
  }),
  on(deleteProvisionedServerFailure, (state, { error }) => ({
    ...state,
    deletingProvisionedServer: Object.keys(state.deletingProvisionedServer).reduce(
      (acc, key) => ({ ...acc, [key]: false }),
      {} as Record<string, boolean>,
    ),
    error,
  })),
  // Client User Management
  on(loadClientUsers, (state, { clientId }) => ({
    ...state,
    loadingClientUsers: { ...state.loadingClientUsers, [clientId]: true },
    error: null,
  })),
  on(loadClientUsersSuccess, (state, { clientId, users }) => ({
    ...state,
    clientUsers: { ...state.clientUsers, [clientId]: users },
    loadingClientUsers: { ...state.loadingClientUsers, [clientId]: false },
    error: null,
  })),
  on(loadClientUsersFailure, (state, { clientId, error }) => ({
    ...state,
    loadingClientUsers: { ...state.loadingClientUsers, [clientId]: false },
    error,
  })),
  on(addClientUser, (state, { clientId }) => ({
    ...state,
    addingClientUser: { ...state.addingClientUser, [clientId]: true },
    error: null,
  })),
  on(addClientUserSuccess, (state, { clientId, user }) => {
    const existingUsers = state.clientUsers[clientId] ?? [];

    return {
      ...state,
      clientUsers: { ...state.clientUsers, [clientId]: [...existingUsers, user] },
      addingClientUser: { ...state.addingClientUser, [clientId]: false },
      error: null,
    };
  }),
  on(addClientUserFailure, (state, { clientId, error }) => ({
    ...state,
    addingClientUser: { ...state.addingClientUser, [clientId]: false },
    error,
  })),
  on(removeClientUser, (state, { relationshipId }) => ({
    ...state,
    removingClientUser: { ...state.removingClientUser, [relationshipId]: true },
    error: null,
  })),
  on(removeClientUserSuccess, (state, { clientId, relationshipId }) => {
    const existingUsers = state.clientUsers[clientId] ?? [];
    const updatedUsers = existingUsers.filter((u) => u.id !== relationshipId);
    const { [relationshipId]: _, ...restRemoving } = state.removingClientUser;

    return {
      ...state,
      clientUsers: { ...state.clientUsers, [clientId]: updatedUsers },
      removingClientUser: restRemoving,
      error: null,
    };
  }),
  on(removeClientUserFailure, (state, { relationshipId, error }) => {
    const { [relationshipId]: _, ...restRemoving } = state.removingClientUser;

    return {
      ...state,
      removingClientUser: restRemoving,
      error,
    };
  }),
  // Workspace reachability
  on(pingClients, (state, { clientIds }) => ({
    ...state,
    reachabilityErrors: {
      ...state.reachabilityErrors,
      ...Object.fromEntries(clientIds.map((id) => [id, state.reachabilityErrors[id] ?? null])),
    },
  })),
  on(pingClientSuccess, (state, { clientId, result }) => ({
    ...state,
    reachabilityErrors: {
      ...state.reachabilityErrors,
      [clientId]: result.reachable ? null : (result.error ?? 'Workspace cannot be reached'),
    },
  })),
  on(pingClientFailure, (state, { clientId }) => ({
    ...state,
    reachabilityErrors: { ...state.reachabilityErrors, [clientId]: null },
  })),
  // A successful environment load proves the workspace is reachable again: drop a stale ping error.
  on(loadClientAgentsSuccess, (state, { clientId }) =>
    state.reachabilityErrors[clientId]
      ? { ...state, reachabilityErrors: { ...state.reachabilityErrors, [clientId]: null } }
      : state,
  ),
  // Container Isolation
  on(refreshClientIsolation, (state, { clientId }) => ({
    ...state,
    refreshingIsolation: { ...state.refreshingIsolation, [clientId]: true },
    isolationErrors: { ...state.isolationErrors, [clientId]: null },
  })),
  on(refreshClientIsolationSuccess, (state, { clientId, isolation }) => ({
    ...state,
    entities: state.entities.map((c) => (c.id === clientId ? { ...c, isolation } : c)),
    railPage: patchRailRow(state.railPage, clientId, (c) => ({ ...c, isolation })),
    selectedClient:
      state.selectedClient?.id === clientId ? { ...state.selectedClient, isolation } : state.selectedClient,
    refreshingIsolation: { ...state.refreshingIsolation, [clientId]: false },
    isolationErrors: { ...state.isolationErrors, [clientId]: null },
  })),
  // Kept per client (not in `error`) so a failed refresh does not block unrelated workspace modals.
  on(refreshClientIsolationFailure, (state, { clientId, error }) => ({
    ...state,
    refreshingIsolation: { ...state.refreshingIsolation, [clientId]: false },
    isolationErrors: { ...state.isolationErrors, [clientId]: error },
  })),
);
