import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ClientsState } from './clients.reducer';

export const selectClientsState = createFeatureSelector<ClientsState>('clients');

// Entity selectors
export const selectClients = createSelector(selectClientsState, (state) => state.entities);

/** Workspaces the one-time list ping found unreachable (clientId → reason). */
export const selectClientReachabilityErrors = createSelector(selectClientsState, (state) =>
  Object.fromEntries(
    Object.entries(state.reachabilityErrors ?? {}).filter((entry): entry is [string, string] => !!entry[1]),
  ),
);

export const selectSelectedClient = createSelector(selectClientsState, (state) => state.selectedClient);

export const selectActiveClientId = createSelector(selectClientsState, (state) => state.activeClientId);

export const selectActiveClient = createSelector(
  selectClients,
  selectActiveClientId,
  selectSelectedClient,
  (clients, activeClientId, selectedClient) => {
    if (!activeClientId) {
      return null;
    }

    return (
      clients.find((c) => c.id === activeClientId) ?? (selectedClient?.id === activeClientId ? selectedClient : null)
    );
  },
);

export const selectActiveClientIsolation = createSelector(selectActiveClient, (client) => client?.isolation ?? null);

// Loading state selectors
export const selectClientsLoading = createSelector(selectClientsState, (state) => state.loading);

export const selectClientLoading = createSelector(selectClientsState, (state) => state.loadingClient);

export const selectClientCreating = createSelector(selectClientsState, (state) => state.creating);

export const selectClientUpdating = createSelector(selectClientsState, (state) => state.updating);

export const selectClientDeleting = createSelector(selectClientsState, (state) => state.deleting);

// Combined loading selector (true if any operation is loading)
export const selectClientsLoadingAny = createSelector(
  selectClientsLoading,
  selectClientLoading,
  selectClientCreating,
  selectClientUpdating,
  selectClientDeleting,
  (loading, loadingClient, creating, updating, deleting) =>
    loading || loadingClient || creating || updating || deleting,
);

// Error selector
export const selectClientsError = createSelector(selectClientsState, (state) => state.error);

export const selectClientsHasMore = createSelector(selectClientsState, (state) => state.hasMore);

export const selectClientsNextOffset = createSelector(selectClientsState, (state) => state.nextOffset);

export const selectClientsAppendLoading = createSelector(selectClientsState, (state) => state.appendLoading);

export const selectClientsAppendError = createSelector(selectClientsState, (state) => state.appendError);

// Derived selectors
export const selectClientsCount = createSelector(selectClients, (clients) => clients.length);

export const selectClientById = (id: string) =>
  createSelector(selectClients, (clients) => clients.find((c) => c.id === id) ?? null);

export const selectHasClients = createSelector(selectClients, (clients) => clients.length > 0);

// Provisioning selectors
export const selectProvisioningProviders = createSelector(selectClientsState, (state) => state.provisioningProviders);

export const selectLoadingProviders = createSelector(selectClientsState, (state) => state.loadingProviders);

export const selectServerTypes = (providerType: string) =>
  createSelector(selectClientsState, (state) => state.serverTypes[providerType] ?? []);

export const selectLoadingServerTypes = (providerType: string) =>
  createSelector(selectClientsState, (state) => state.loadingServerTypes[providerType] ?? false);

export const selectLocations = (providerType: string) =>
  createSelector(selectClientsState, (state) => state.locations[providerType] ?? []);

export const selectLoadingLocations = (providerType: string) =>
  createSelector(selectClientsState, (state) => state.loadingLocations[providerType] ?? false);

export const selectProvisioning = createSelector(selectClientsState, (state) => state.provisioning);

export const selectServerInfo = (clientId: string) =>
  createSelector(selectClientsState, (state) => state.serverInfo[clientId]);

export const selectLoadingServerInfo = (clientId: string) =>
  createSelector(selectClientsState, (state) => state.loadingServerInfo[clientId] ?? false);

export const selectDeletingProvisionedServer = (clientId: string) =>
  createSelector(selectClientsState, (state) => state.deletingProvisionedServer[clientId] ?? false);

// Client user management selectors
export const selectClientUsers = (clientId: string) =>
  createSelector(selectClientsState, (state) => state.clientUsers[clientId] ?? []);

export const selectLoadingClientUsers = (clientId: string) =>
  createSelector(selectClientsState, (state) => state.loadingClientUsers[clientId] ?? false);

export const selectAddingClientUser = (clientId: string) =>
  createSelector(selectClientsState, (state) => state.addingClientUser[clientId] ?? false);

export const selectRemovingClientUser = (relationshipId: string) =>
  createSelector(selectClientsState, (state) => state.removingClientUser[relationshipId] ?? false);

// Container isolation selectors
export const selectRefreshingClientIsolation = (clientId: string) =>
  createSelector(selectClientsState, (state) => state.refreshingIsolation[clientId] ?? false);

export const selectClientIsolationError = (clientId: string) =>
  createSelector(selectClientsState, (state) => state.isolationErrors[clientId] ?? null);
