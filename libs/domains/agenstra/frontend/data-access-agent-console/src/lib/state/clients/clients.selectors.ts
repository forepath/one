import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ClientsState } from './clients.reducer';

export const selectClientsState = createFeatureSelector<ClientsState>('clients');

// Entity selectors
export const selectClients = createSelector(selectClientsState, (state) => state.entities);

export const selectSelectedClient = createSelector(selectClientsState, (state) => state.selectedClient);

export const selectActiveClientId = createSelector(selectClientsState, (state) => state.activeClientId);

export const selectActiveClient = createSelector(selectClients, selectActiveClientId, (clients, activeClientId) =>
  activeClientId ? (clients.find((c) => c.id === activeClientId) ?? null) : null,
);

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
