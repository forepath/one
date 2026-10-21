import { createAction, props } from '@ngrx/store';

import type {
  ClientPingResponseDto,
  AddClientUserDto,
  ClientIsolationSummaryDto,
  ClientResponseDto,
  ClientUserResponseDto,
  CreateClientDto,
  CreateClientResponseDto,
  ListClientsParams,
  ProvisionServerDto,
  ProvisionedServerResponseDto,
  ProvisioningProviderInfo,
  ProviderLocation,
  ServerInfo,
  ServerType,
  UpdateClientDto,
} from './clients.types';

// List Clients Actions
export const loadClients = createAction('[Clients] Load Clients', props<{ params?: ListClientsParams }>());

export const loadClientsSuccess = createAction(
  '[Clients] Load Clients Success',
  props<{ clients: ClientResponseDto[]; hasMore: boolean; nextOffset: number }>(),
);

export const loadClientsFailure = createAction('[Clients] Load Clients Failure', props<{ error: string }>());

export const loadMoreClients = createAction('[Clients] Load More Clients');

export const loadMoreClientsSuccess = createAction(
  '[Clients] Load More Clients Success',
  props<{ clients: ClientResponseDto[]; hasMore: boolean; nextOffset: number }>(),
);

export const loadMoreClientsFailure = createAction('[Clients] Load More Clients Failure', props<{ error: string }>());

// Get Client by ID Actions
export const loadClient = createAction('[Clients] Load Client', props<{ id: string }>());

export const loadClientSuccess = createAction('[Clients] Load Client Success', props<{ client: ClientResponseDto }>());

export const loadClientFailure = createAction('[Clients] Load Client Failure', props<{ error: string }>());

// Create Client Actions
export const createClient = createAction('[Clients] Create Client', props<{ client: CreateClientDto }>());

export const createClientSuccess = createAction(
  '[Clients] Create Client Success',
  props<{ client: CreateClientResponseDto }>(),
);

export const createClientFailure = createAction('[Clients] Create Client Failure', props<{ error: string }>());

// Update Client Actions
export const updateClient = createAction('[Clients] Update Client', props<{ id: string; client: UpdateClientDto }>());

export const updateClientSuccess = createAction(
  '[Clients] Update Client Success',
  props<{ client: ClientResponseDto }>(),
);

export const updateClientFailure = createAction('[Clients] Update Client Failure', props<{ error: string }>());

// Delete Client Actions
export const deleteClient = createAction('[Clients] Delete Client', props<{ id: string }>());

export const deleteClientSuccess = createAction('[Clients] Delete Client Success', props<{ id: string }>());

export const deleteClientFailure = createAction('[Clients] Delete Client Failure', props<{ error: string }>());

// Set Active Client Actions
export const setActiveClient = createAction('[Clients] Set Active Client', props<{ id: string }>());

export const setActiveClientSuccess = createAction('[Clients] Set Active Client Success', props<{ id: string }>());

export const setActiveClientFailure = createAction('[Clients] Set Active Client Failure', props<{ error: string }>());

// Clear Active Client Actions
export const clearActiveClient = createAction('[Clients] Clear Active Client');

// Container Isolation Actions
/** Reload the isolation levels of a workspace host; `probe` re-runs the runtime probes first. */
export const refreshClientIsolation = createAction(
  '[Clients] Refresh Client Isolation',
  props<{ clientId: string; probe?: boolean }>(),
);

export const refreshClientIsolationSuccess = createAction(
  '[Clients] Refresh Client Isolation Success',
  props<{ clientId: string; isolation: ClientIsolationSummaryDto }>(),
);

export const refreshClientIsolationFailure = createAction(
  '[Clients] Refresh Client Isolation Failure',
  props<{ clientId: string; error: string }>(),
);

// Workspace reachability (pinged once per listed workspace)
export const pingClients = createAction('[Clients] Ping Clients', props<{ clientIds: string[] }>());

export const pingClientSuccess = createAction(
  '[Clients] Ping Client Success',
  props<{ clientId: string; result: ClientPingResponseDto }>(),
);

/** The ping request itself failed (e.g. no access): reachability stays unknown, nothing is flagged. */
export const pingClientFailure = createAction('[Clients] Ping Client Failure', props<{ clientId: string }>());

// Provisioning Actions
export const loadProvisioningProviders = createAction('[Clients] Load Provisioning Providers');

export const loadProvisioningProvidersSuccess = createAction(
  '[Clients] Load Provisioning Providers Success',
  props<{ providers: ProvisioningProviderInfo[] }>(),
);

export const loadProvisioningProvidersFailure = createAction(
  '[Clients] Load Provisioning Providers Failure',
  props<{ error: string }>(),
);

export const loadServerTypes = createAction('[Clients] Load Server Types', props<{ providerType: string }>());

export const loadServerTypesSuccess = createAction(
  '[Clients] Load Server Types Success',
  props<{ providerType: string; serverTypes: ServerType[] }>(),
);

export const loadServerTypesFailure = createAction('[Clients] Load Server Types Failure', props<{ error: string }>());

export const loadLocations = createAction('[Clients] Load Locations', props<{ providerType: string }>());

export const loadLocationsSuccess = createAction(
  '[Clients] Load Locations Success',
  props<{ providerType: string; locations: ProviderLocation[] }>(),
);

export const loadLocationsFailure = createAction('[Clients] Load Locations Failure', props<{ error: string }>());

export const provisionServer = createAction('[Clients] Provision Server', props<{ dto: ProvisionServerDto }>());

export const provisionServerSuccess = createAction(
  '[Clients] Provision Server Success',
  props<{ server: ProvisionedServerResponseDto }>(),
);

export const provisionServerFailure = createAction('[Clients] Provision Server Failure', props<{ error: string }>());

export const loadServerInfo = createAction('[Clients] Load Server Info', props<{ clientId: string }>());

export const loadServerInfoSuccess = createAction(
  '[Clients] Load Server Info Success',
  props<{ clientId: string; serverInfo: ServerInfo }>(),
);

export const loadServerInfoFailure = createAction(
  '[Clients] Load Server Info Failure',
  props<{ clientId: string; error: string }>(),
);

export const deleteProvisionedServer = createAction(
  '[Clients] Delete Provisioned Server',
  props<{ clientId: string }>(),
);

export const deleteProvisionedServerSuccess = createAction(
  '[Clients] Delete Provisioned Server Success',
  props<{ clientId: string }>(),
);

export const deleteProvisionedServerFailure = createAction(
  '[Clients] Delete Provisioned Server Failure',
  props<{ error: string }>(),
);

// Client User Management Actions
export const loadClientUsers = createAction('[Clients] Load Client Users', props<{ clientId: string }>());

export const loadClientUsersSuccess = createAction(
  '[Clients] Load Client Users Success',
  props<{ clientId: string; users: ClientUserResponseDto[] }>(),
);

export const loadClientUsersFailure = createAction(
  '[Clients] Load Client Users Failure',
  props<{ clientId: string; error: string }>(),
);

export const addClientUser = createAction(
  '[Clients] Add Client User',
  props<{ clientId: string; dto: AddClientUserDto }>(),
);

export const addClientUserSuccess = createAction(
  '[Clients] Add Client User Success',
  props<{ clientId: string; user: ClientUserResponseDto }>(),
);

export const addClientUserFailure = createAction(
  '[Clients] Add Client User Failure',
  props<{ clientId: string; error: string }>(),
);

export const removeClientUser = createAction(
  '[Clients] Remove Client User',
  props<{ clientId: string; relationshipId: string }>(),
);

export const removeClientUserSuccess = createAction(
  '[Clients] Remove Client User Success',
  props<{ clientId: string; relationshipId: string }>(),
);

export const removeClientUserFailure = createAction(
  '[Clients] Remove Client User Failure',
  props<{ clientId: string; relationshipId: string; error: string }>(),
);
