import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  addClientUser,
  clearActiveClient,
  createClient,
  deleteClient,
  deleteProvisionedServer,
  loadClient,
  loadClientUsers,
  loadClients,
  loadProvisioningProviders,
  loadServerInfo,
  loadServerTypes,
  provisionServer,
  removeClientUser,
  setActiveClient,
  updateClient,
} from './clients.actions';
import {
  selectActiveClient,
  selectActiveClientId,
  selectAddingClientUser,
  selectClientById,
  selectClientCreating,
  selectClientDeleting,
  selectClientLoading,
  selectClientUpdating,
  selectClients,
  selectClientsCount,
  selectClientsError,
  selectClientsLoading,
  selectClientsLoadingAny,
  selectClientUsers,
  selectDeletingProvisionedServer,
  selectHasClients,
  selectLoadingClientUsers,
  selectLoadingProviders,
  selectLoadingServerInfo,
  selectLoadingServerTypes,
  selectProvisioning,
  selectProvisioningProviders,
  selectRemovingClientUser,
  selectSelectedClient,
  selectServerInfo,
  selectServerTypes,
} from './clients.selectors';
import type {
  AddClientUserDto,
  ClientResponseDto,
  ClientUserResponseDto,
  CreateClientDto,
  ListClientsParams,
  ProvisionServerDto,
  ServerInfo,
  ServerType,
  UpdateClientDto,
} from './clients.types';

/**
 * Facade for clients state management.
 * Provides a clean API for components to interact with clients state
 * without directly accessing the NgRx store.
 */
@Injectable({
  providedIn: 'root',
})
export class ClientsFacade {
  private readonly store = inject(Store);

  // State observables
  readonly clients$: Observable<ClientResponseDto[]> = this.store.select(selectClients);
  readonly selectedClient$: Observable<ClientResponseDto | null> = this.store.select(selectSelectedClient);
  readonly activeClientId$: Observable<string | null> = this.store.select(selectActiveClientId);
  readonly activeClient$: Observable<ClientResponseDto | null> = this.store.select(selectActiveClient);

  // Loading state observables
  readonly loading$: Observable<boolean> = this.store.select(selectClientsLoading);
  readonly loadingClient$: Observable<boolean> = this.store.select(selectClientLoading);
  readonly creating$: Observable<boolean> = this.store.select(selectClientCreating);
  readonly updating$: Observable<boolean> = this.store.select(selectClientUpdating);
  readonly deleting$: Observable<boolean> = this.store.select(selectClientDeleting);
  readonly loadingAny$: Observable<boolean> = this.store.select(selectClientsLoadingAny);

  // Error observable
  readonly error$: Observable<string | null> = this.store.select(selectClientsError);

  // Derived state observables
  readonly clientsCount$: Observable<number> = this.store.select(selectClientsCount);
  readonly hasClients$: Observable<boolean> = this.store.select(selectHasClients);

  /**
   * Load all clients with optional pagination.
   */
  loadClients(params?: ListClientsParams): void {
    this.store.dispatch(loadClients({ params }));
  }

  /**
   * Load a specific client by ID.
   */
  loadClient(id: string): void {
    this.store.dispatch(loadClient({ id }));
  }

  /**
   * Create a new client.
   */
  createClient(client: CreateClientDto): void {
    this.store.dispatch(createClient({ client }));
  }

  /**
   * Update an existing client.
   */
  updateClient(id: string, client: UpdateClientDto): void {
    this.store.dispatch(updateClient({ id, client }));
  }

  /**
   * Delete a client.
   */
  deleteClient(id: string): void {
    this.store.dispatch(deleteClient({ id }));
  }

  /**
   * Set the active client by ID.
   */
  setActiveClient(id: string): void {
    this.store.dispatch(setActiveClient({ id }));
  }

  /**
   * Clear the active client.
   */
  clearActiveClient(): void {
    this.store.dispatch(clearActiveClient());
  }

  /**
   * Get a client by ID as an observable.
   * @param id - The client ID
   * @returns Observable of the client or null if not found
   */
  getClientById$(id: string): Observable<ClientResponseDto | null> {
    return this.store.select(selectClientById(id));
  }

  // Provisioning state observables
  readonly provisioningProviders$: Observable<Array<{ type: string; displayName: string }>> =
    this.store.select(selectProvisioningProviders);
  readonly loadingProviders$: Observable<boolean> = this.store.select(selectLoadingProviders);
  readonly provisioning$: Observable<boolean> = this.store.select(selectProvisioning);

  /**
   * Get server types for a provider as an observable.
   * @param providerType - The provider type
   * @returns Observable of server types array
   */
  getServerTypes$(providerType: string): Observable<ServerType[]> {
    return this.store.select(selectServerTypes(providerType));
  }

  /**
   * Get loading state for server types as an observable.
   * @param providerType - The provider type
   * @returns Observable of loading state
   */
  getLoadingServerTypes$(providerType: string): Observable<boolean> {
    return this.store.select(selectLoadingServerTypes(providerType));
  }

  /**
   * Get server info for a client as an observable.
   * @param clientId - The client ID
   * @returns Observable of server info or undefined
   */
  getServerInfo$(clientId: string): Observable<ServerInfo | undefined> {
    return this.store.select(selectServerInfo(clientId));
  }

  /**
   * Get loading state for server info as an observable.
   * @param clientId - The client ID
   * @returns Observable of loading state
   */
  getLoadingServerInfo$(clientId: string): Observable<boolean> {
    return this.store.select(selectLoadingServerInfo(clientId));
  }

  /**
   * Get deleting state for provisioned server as an observable.
   * @param clientId - The client ID
   * @returns Observable of deleting state
   */
  getDeletingProvisionedServer$(clientId: string): Observable<boolean> {
    return this.store.select(selectDeletingProvisionedServer(clientId));
  }

  /**
   * Load all available provisioning providers.
   */
  loadProvisioningProviders(): void {
    this.store.dispatch(loadProvisioningProviders());
  }

  /**
   * Load server types for a specific provider.
   * @param providerType - The provider type (e.g., 'hetzner')
   */
  loadServerTypes(providerType: string): void {
    this.store.dispatch(loadServerTypes({ providerType }));
  }

  /**
   * Provision a new server and create a client.
   * @param dto - Provisioning options
   */
  provisionServer(dto: ProvisionServerDto): void {
    this.store.dispatch(provisionServer({ dto }));
  }

  /**
   * Load server information for a provisioned client.
   * @param clientId - The client ID
   */
  loadServerInfo(clientId: string): void {
    this.store.dispatch(loadServerInfo({ clientId }));
  }

  /**
   * Delete a provisioned server and its associated client.
   * @param clientId - The client ID
   */
  deleteProvisionedServer(clientId: string): void {
    this.store.dispatch(deleteProvisionedServer({ clientId }));
  }

  // Client user management

  /**
   * Load users associated with a client.
   * @param clientId - The client ID
   */
  loadClientUsers(clientId: string): void {
    this.store.dispatch(loadClientUsers({ clientId }));
  }

  /**
   * Add a user to a client by email.
   * @param clientId - The client ID
   * @param dto - Email and role for the user to add
   */
  addClientUser(clientId: string, dto: AddClientUserDto): void {
    this.store.dispatch(addClientUser({ clientId, dto }));
  }

  /**
   * Remove a user from a client.
   * @param clientId - The client ID
   * @param relationshipId - The client-user relationship ID to remove
   */
  removeClientUser(clientId: string, relationshipId: string): void {
    this.store.dispatch(removeClientUser({ clientId, relationshipId }));
  }

  /**
   * Get client users as an observable.
   * @param clientId - The client ID
   * @returns Observable of client users array
   */
  getClientUsers$(clientId: string): Observable<ClientUserResponseDto[]> {
    return this.store.select(selectClientUsers(clientId));
  }

  /**
   * Get loading state for client users as an observable.
   * @param clientId - The client ID
   * @returns Observable of loading state
   */
  getLoadingClientUsers$(clientId: string): Observable<boolean> {
    return this.store.select(selectLoadingClientUsers(clientId));
  }

  /**
   * Get adding state for client user as an observable.
   * @param clientId - The client ID
   * @returns Observable of adding state
   */
  getAddingClientUser$(clientId: string): Observable<boolean> {
    return this.store.select(selectAddingClientUser(clientId));
  }

  /**
   * Get removing state for client user as an observable.
   * @param relationshipId - The relationship ID
   * @returns Observable of removing state
   */
  getRemovingClientUser$(relationshipId: string): Observable<boolean> {
    return this.store.select(selectRemovingClientUser(relationshipId));
  }
}
