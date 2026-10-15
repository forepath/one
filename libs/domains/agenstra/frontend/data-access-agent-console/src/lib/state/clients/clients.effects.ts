import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  catchError,
  defer,
  exhaustMap,
  filter,
  finalize,
  groupBy,
  map,
  mergeMap,
  of,
  switchMap,
  withLatestFrom,
} from 'rxjs';

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
  loadClientsFailure,
  loadClientsSuccess,
  loadClientSuccess,
  loadMoreClients,
  loadMoreClientsFailure,
  loadMoreClientsSuccess,
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
  setActiveClient,
  setActiveClientSuccess,
  updateClient,
  updateClientFailure,
  updateClientSuccess,
} from './clients.actions';
import { selectClientById, selectClientsState } from './clients.selectors';

/** Longest plain-text error body shown verbatim (longer bodies are proxy/error pages, not messages). */
const MAX_DISPLAYABLE_ERROR_TEXT_LENGTH = 500;

/** True for short plain-text error bodies; HTML pages (e.g. proxy 502/504 responses) are not shown verbatim. */
function isDisplayableErrorText(body: unknown): body is string {
  if (typeof body !== 'string') {
    return false;
  }

  const text = body.trim();

  return text.length > 0 && text.length <= MAX_DISPLAYABLE_ERROR_TEXT_LENGTH && !text.startsWith('<');
}

/**
 * Normalizes error messages from HTTP errors.
 */
function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { message?: unknown } | string | null | undefined;

    if (isDisplayableErrorText(body)) {
      return body.trim();
    }

    if (body && typeof body === 'object' && typeof body.message === 'string' && body.message.trim().length > 0) {
      return body.message;
    }

    return error.message || String(error.status);
  }

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
      switchMap(({ params }) => {
        const batchParams = {
          limit: params?.limit ?? BATCH_SIZE,
          offset: params?.offset ?? 0,
          search: params?.search?.trim() || undefined,
        };

        return clientsService.listClients(batchParams).pipe(
          map((clients) =>
            loadClientsSuccess({
              clients,
              hasMore: clients.length === BATCH_SIZE,
              nextOffset: clients.length,
            }),
          ),
          catchError((error) => of(loadClientsFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const loadMoreClients$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService), store = inject(Store)) => {
    return actions$.pipe(
      ofType(loadMoreClients),
      withLatestFrom(store.select(selectClientsState)),
      filter(([, state]) => state.hasMore && !state.loading && !state.appendLoading),
      exhaustMap(([, state]) => {
        const batchParams = {
          limit: BATCH_SIZE,
          offset: state.nextOffset,
          search: state.search ?? undefined,
        };

        return clientsService.listClients(batchParams).pipe(
          map((clients) =>
            loadMoreClientsSuccess({
              clients,
              hasMore: clients.length === BATCH_SIZE,
              nextOffset: state.nextOffset + clients.length,
            }),
          ),
          catchError((error) => of(loadMoreClientsFailure({ error: normalizeError(error) }))),
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

// Container Isolation Effects
export const refreshClientIsolation$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(refreshClientIsolation),
      // Latest request wins per workspace: an older response must not overwrite a newer probe result.
      // A plain refresh never cancels an in-flight re-probe ("Re-check isolation") of the same workspace.
      groupBy(({ clientId }) => clientId),
      mergeMap((group$) => {
        let probeInFlight = false;

        return group$.pipe(
          filter(({ probe }) => !!probe || !probeInFlight),
          switchMap(({ clientId, probe }) =>
            defer(() => {
              probeInFlight = !!probe;

              return probe
                ? clientsService.probeClientIsolation(clientId)
                : clientsService.getClientIsolation(clientId);
            }).pipe(
              map((isolation) => refreshClientIsolationSuccess({ clientId, isolation })),
              catchError((error) => of(refreshClientIsolationFailure({ clientId, error: normalizeError(error) }))),
              finalize(() => {
                if (probe) {
                  probeInFlight = false;
                }
              }),
            ),
          ),
        );
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

export const loadLocations$ = createEffect(
  (actions$ = inject(Actions), clientsService = inject(ClientsService)) => {
    return actions$.pipe(
      ofType(loadLocations),
      exhaustMap(({ providerType }) =>
        clientsService.getLocations(providerType).pipe(
          map((locations) => loadLocationsSuccess({ providerType, locations })),
          catchError((error) => of(loadLocationsFailure({ error: normalizeError(error) }))),
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
