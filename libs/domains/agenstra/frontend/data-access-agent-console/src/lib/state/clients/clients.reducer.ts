import { createReducer, on } from '@ngrx/store';

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
  loadClientsBatch,
  loadClientsFailure,
  loadClientsSuccess,
  loadClientSuccess,
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
  provisionServer,
  provisionServerFailure,
  provisionServerSuccess,
  removeClientUser,
  removeClientUserFailure,
  removeClientUserSuccess,
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
  ProvisioningProviderInfo,
  ServerInfo,
  ServerType,
} from './clients.types';

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
  // Provisioning state
  provisioningProviders: ProvisioningProviderInfo[];
  loadingProviders: boolean;
  serverTypes: Record<string, ServerType[]>; // keyed by providerType
  loadingServerTypes: Record<string, boolean>; // keyed by providerType
  provisioning: boolean;
  serverInfo: Record<string, ServerInfo>; // keyed by clientId
  loadingServerInfo: Record<string, boolean>; // keyed by clientId
  deletingProvisionedServer: Record<string, boolean>; // keyed by clientId
  // Client user management (per-client permissions)
  clientUsers: Record<string, ClientUserResponseDto[]>; // keyed by clientId
  loadingClientUsers: Record<string, boolean>; // keyed by clientId
  addingClientUser: Record<string, boolean>; // keyed by clientId
  removingClientUser: Record<string, boolean>; // keyed by relationshipId
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
  provisioningProviders: [],
  loadingProviders: false,
  serverTypes: {},
  loadingServerTypes: {},
  provisioning: false,
  serverInfo: {},
  loadingServerInfo: {},
  deletingProvisionedServer: {},
  clientUsers: {},
  loadingClientUsers: {},
  addingClientUser: {},
  removingClientUser: {},
};

export const clientsReducer = createReducer(
  initialClientsState,
  // Load Clients
  on(loadClients, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(loadClientsBatch, (state, { accumulatedClients }) => ({
    ...state,
    entities: accumulatedClients,
    loading: true, // Keep loading true during batch loading
    error: null,
  })),
  on(loadClientsSuccess, (state, { clients }) => ({
    ...state,
    entities: clients,
    loading: false,
    error: null,
  })),
  on(loadClientsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
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
    entities: state.entities.filter((c) => c.id !== id),
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
  on(setActiveClientSuccess, (state, { id }) => ({
    ...state,
    activeClientId: id,
    error: null,
  })),
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
);
