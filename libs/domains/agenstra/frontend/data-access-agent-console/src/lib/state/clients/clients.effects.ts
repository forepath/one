import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, exhaustMap, map, mergeMap, of, switchMap } from 'rxjs';

import { ClientsService } from '../../services/clients.service';

import {
  addClientUser,
  addClientUserFailure,
  addClientUserSuccess,
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
  loadClientUsers,
  loadClientUsersFailure,
  loadClientUsersSuccess,
  loadClients,
  loadClientsBatch,
  loadClientsFailure,
  loadClientsSuccess,
  loadClientSuccess,
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
  setActiveClientSuccess,
  updateClient,
  updateClientFailure,
  updateClientSuccess,
} from './clients.actions';
import { selectClientById } from './clients.selectors';

/**
 * Normalizes error messages from HTTP errors.
 */
function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }

  return 'An unexpected error occurred';
}

const BATCH_SIZE = 10;

export const loadClients$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(loadClients),
      switchMap(() => {
        // Start with offset 0, limit 10, ignore user params for batch loading
        const batchParams = { limit: BATCH_SIZE, offset: 0 };

        return clientsService.listClients(batchParams).pipe(
          switchMap((clients) => {
            if (clients.length === 0) {
              // No entries, dispatch success with empty array
              return of(loadClientsSuccess({ clients: [] }));
            }

            // Has entries, check if we got a full batch (might be more)
            if (clients.length < BATCH_SIZE) {
              // Partial batch, we're done
              return of(loadClientsSuccess({ clients }));
            }

            // Full batch, load next batch
            return of(loadClientsBatch({ offset: BATCH_SIZE, accumulatedClients: clients }));
          }),
          catchError((error) => of(loadClientsFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadClientsBatch$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(loadClientsBatch),
      switchMap(({ offset, accumulatedClients }) => {
        const batchParams = { limit: BATCH_SIZE, offset };

        return clientsService.listClients(batchParams).pipe(
          switchMap((clients) => {
            const newAccumulated = [...accumulatedClients, ...clients];

            if (clients.length === 0) {
              // No more entries, dispatch success with all accumulated
              return of(loadClientsSuccess({ clients: newAccumulated }));
            }

            // Has entries, check if we got a full batch (might be more)
            if (clients.length < BATCH_SIZE) {
              // Partial batch, we're done
              return of(loadClientsSuccess({ clients: newAccumulated }));
            }

            // Full batch, load next batch
            return of(loadClientsBatch({ offset: offset + BATCH_SIZE, accumulatedClients: newAccumulated }));
          }),
          catchError((error) => of(loadClientsFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadClient$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(loadClient),
      switchMap(({ id }) =>
        clientsService.getClient(id).pipe(
          map((client) => loadClientSuccess({ client })),
          catchError((error) => of(loadClientFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createClient$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(createClient),
      exhaustMap(({ client }) =>
        clientsService.createClient(client).pipe(
          map((createdClient) => createClientSuccess({ client: createdClient })),
          catchError((error) => of(createClientFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateClient$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(updateClient),
      exhaustMap(({ id, client }) =>
        clientsService.updateClient(id, client).pipe(
          map((updatedClient) => updateClientSuccess({ client: updatedClient })),
          catchError((error) => of(updateClientFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteClient$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(deleteClient),
      exhaustMap(({ id }) =>
        clientsService.deleteClient(id).pipe(
          map(() => deleteClientSuccess({ id })),
          catchError((error) => of(deleteClientFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const setActiveClient$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(setActiveClient),
      exhaustMap(({ id }) => {
        // For now, setActiveClient is a local state operation
        // If it requires an API call in the future, inject the service here
        return of(setActiveClientSuccess({ id }));
      }),
    );
  },
  { functional: true },
);

// Provisioning Effects
export const loadProvisioningProviders$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(loadProvisioningProviders),
      exhaustMap(() =>
        clientsService.listProvisioningProviders().pipe(
          map((providers) => loadProvisioningProvidersSuccess({ providers })),
          catchError((error) => of(loadProvisioningProvidersFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadServerTypes$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(loadServerTypes),
      exhaustMap(({ providerType }) =>
        clientsService.getServerTypes(providerType).pipe(
          map((serverTypes) => loadServerTypesSuccess({ providerType, serverTypes })),
          catchError((error) => of(loadServerTypesFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const provisionServer$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(provisionServer),
      exhaustMap(({ dto }) =>
        clientsService.provisionServer(dto).pipe(
          map((server) => provisionServerSuccess({ server })),
          catchError((error) => of(provisionServerFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadServerInfo$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService), store = inject(Store)) => {
    return actions$.pipe(
      ofType(loadServerInfo),
      mergeMap(({ clientId }) =>
        store.select(selectClientById(clientId)).pipe(
          switchMap((client) => {
            // Skip API call if client is not auto-provisioned to avoid 404s and protect rate limits
            if (!client?.isAutoProvisioned) {
              // Client is not auto-provisioned, skip the API call
              // Return a failure action with empty error to mark loading as complete without setting error state
              return of(loadServerInfoFailure({ clientId, error: '' }));
            }

            // Client is auto-provisioned, proceed with API call
            return clientsService.getServerInfo(clientId).pipe(
              map((serverInfo) => loadServerInfoSuccess({ clientId, serverInfo })),
              catchError((error) => {
                // Handle 404 gracefully - client doesn't have provisioning, this is expected
                if (error instanceof HttpErrorResponse && error.status === 404) {
                  // Silently ignore 404 - client doesn't have provisioning
                  // Don't set error state, just mark loading as complete
                  return of(loadServerInfoFailure({ clientId, error: '' }));
                }

                // For other errors, set the error message
                return of(loadServerInfoFailure({ clientId, error: normalizeError(error) }));
              }),
            );
          }),
        ),
      ),
    );
  },
  { functional: true },
);

// Automatically load server info after successful provisioning
export const loadServerInfoAfterProvisioning$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(provisionServerSuccess),
      map(({ server }) => {
        // Extract client ID from the server response
        // The server response is a ProvisionedServerResponseDto which extends ClientResponseDto
        return loadServerInfo({ clientId: server.id });
      }),
    );
  },
  { functional: true },
);

export const deleteProvisionedServer$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(deleteProvisionedServer),
      exhaustMap(({ clientId }) =>
        clientsService.deleteProvisionedServer(clientId).pipe(
          map(() => deleteProvisionedServerSuccess({ clientId })),
          catchError((error) => of(deleteProvisionedServerFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

// Client User Management Effects
export const loadClientUsers$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(loadClientUsers),
      exhaustMap(({ clientId }) =>
        clientsService.getClientUsers(clientId).pipe(
          map((users) => loadClientUsersSuccess({ clientId, users })),
          catchError((error) => of(loadClientUsersFailure({ clientId, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const addClientUser$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(addClientUser),
      exhaustMap(({ clientId, dto }) =>
        clientsService.addClientUser(clientId, dto).pipe(
          map((user) => addClientUserSuccess({ clientId, user })),
          catchError((error) => of(addClientUserFailure({ clientId, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const removeClientUser$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(removeClientUser),
      exhaustMap(({ clientId, relationshipId }) =>
        clientsService.removeClientUser(clientId, relationshipId).pipe(
          map(() => removeClientUserSuccess({ clientId, relationshipId })),
          catchError((error) =>
            of(removeClientUserFailure({ clientId, relationshipId, error: normalizeError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);
