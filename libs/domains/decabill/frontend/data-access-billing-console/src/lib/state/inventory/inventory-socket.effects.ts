import { inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT, resolveApiWebsocketUrl } from '@forepath/decabill/frontend/util-configuration';
import { createSocketAuthOption, OidcAuthService, resolveAuthorizationHeader$ } from '@forepath/identity/frontend';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, fromEvent, map, merge, mergeMap, of, switchMap, tap, withLatestFrom } from 'rxjs';
import { io, type Socket } from 'socket.io-client';

import { resolveBillingTenantId } from '../../interceptors/tenant.interceptor';

import {
  connectInventorySocket,
  disconnectInventorySocket,
  inventoryArticleRemoved,
  inventoryArticleUpsert,
  inventoryCompartmentRemoved,
  inventoryCompartmentUpsert,
  inventoryLendingUpsert,
  inventoryMovementCreated,
  inventoryRequestsChanged,
  inventoryRequestUpsert,
  inventorySerialUnitsChanged,
  inventorySocketStatus,
  inventoryStockRemoved,
  inventoryStockUpsert,
  inventoryWarehouseRemoved,
  inventoryWarehouseUpsert,
  loadInventorySummary,
  reloadInventorySlices,
} from './inventory.actions';
import { inventorySlicesAffectedBy } from './inventory.reducer';
import { selectInventoryState } from './inventory.selectors';

/** Socket.IO event names of the `inventory` namespace (server → client). */
export const INVENTORY_SOCKET_EVENTS = {
  warehouseUpsert: 'warehouseUpsert',
  warehouseRemoved: 'warehouseRemoved',
  compartmentUpsert: 'compartmentUpsert',
  compartmentRemoved: 'compartmentRemoved',
  articleUpsert: 'articleUpsert',
  articleRemoved: 'articleRemoved',
  stockUpsert: 'stockUpsert',
  stockRemoved: 'stockRemoved',
  movementCreated: 'movementCreated',
  requestUpsert: 'requestUpsert',
  requestsChanged: 'requestsChanged',
  lendingUpsert: 'lendingUpsert',
  serialUnitsChanged: 'serialUnitsChanged',
} as const;

export function resolveInventoryWebsocketUrl(environment: Environment): string | null {
  const explicit = resolveApiWebsocketUrl(environment.billing.urls.websocket, 'inventory')?.trim();

  if (explicit) return explicit;

  const base = resolveApiWebsocketUrl(environment.billing.urls.websocket, 'default');

  if (!base) return null;

  try {
    const url = new URL(base);

    return `${url.protocol}//${url.host}/socket/inventory`;
  } catch {
    return `${base.replace(/\/$/, '').replace(/\/billing$/, '')}/inventory`;
  }
}

let inventorySocket: Socket | null = null;

export const connectInventorySocket$ = createEffect(
  (
    actions$ = inject(Actions),
    environment = inject<Environment>(ENVIRONMENT),
    oidcAuthService = inject(OidcAuthService),
  ) =>
    actions$.pipe(
      ofType(connectInventorySocket),
      switchMap(() => {
        const websocketUrl = resolveInventoryWebsocketUrl(environment);

        if (!websocketUrl) {
          return of(inventorySocketStatus({ connected: false, error: 'Inventory WebSocket URL not configured' }));
        }

        inventorySocket?.disconnect();
        inventorySocket = null;

        return resolveAuthorizationHeader$(environment.authentication.config, oidcAuthService).pipe(
          switchMap((authHeader) => {
            if (!authHeader) {
              return of(inventorySocketStatus({ connected: false, error: 'Not authenticated for WebSocket' }));
            }

            const tenantId = resolveBillingTenantId(environment);
            const socket = io(websocketUrl, {
              transports: ['websocket'],
              reconnection: true,
              reconnectionAttempts: 5,
              reconnectionDelay: 1000,
              extraHeaders: { 'X-Tenant': tenantId },
              auth: createSocketAuthOption(environment.authentication.config, authHeader, { tenantId }),
            });

            inventorySocket = socket;

            // (Re)subscribe on every connect; the server only joins admins to the tenant room.
            const connected$ = fromEvent(socket, 'connect').pipe(
              tap(() => socket.emit('subscribeInventory')),
              mergeMap(() =>
                of(
                  inventorySocketStatus({ connected: true }),
                  // Changes made while disconnected: re-read whatever is open.
                  reloadInventorySlices({
                    slices: [
                      'warehouses',
                      'compartments',
                      'compartmentStock',
                      'articles',
                      'articleStock',
                      'requests',
                      'movements',
                    ],
                  }),
                  loadInventorySummary(),
                ),
              ),
            );
            const disconnected$ = fromEvent(socket, 'disconnect').pipe(
              map(() => inventorySocketStatus({ connected: false })),
            );
            const failed$ = fromEvent<Error>(socket, 'connect_error').pipe(
              map((error) => inventorySocketStatus({ connected: false, error: error.message || 'Connection error' })),
            );
            const on = <T>(event: string) => fromEvent<T>(socket, event);

            return merge(
              connected$,
              disconnected$,
              failed$,
              on<never>(INVENTORY_SOCKET_EVENTS.warehouseUpsert).pipe(
                map((warehouse) => inventoryWarehouseUpsert({ warehouse })),
              ),
              on<{ id: string }>(INVENTORY_SOCKET_EVENTS.warehouseRemoved).pipe(
                map(({ id }) => inventoryWarehouseRemoved({ id })),
              ),
              on<never>(INVENTORY_SOCKET_EVENTS.compartmentUpsert).pipe(
                map((compartment) => inventoryCompartmentUpsert({ compartment })),
              ),
              on<{ id: string; warehouseId: string }>(INVENTORY_SOCKET_EVENTS.compartmentRemoved).pipe(
                map((payload) => inventoryCompartmentRemoved(payload)),
              ),
              on<never>(INVENTORY_SOCKET_EVENTS.articleUpsert).pipe(
                map((article) => inventoryArticleUpsert({ article })),
              ),
              on<{ id: string }>(INVENTORY_SOCKET_EVENTS.articleRemoved).pipe(
                map(({ id }) => inventoryArticleRemoved({ id })),
              ),
              on<never>(INVENTORY_SOCKET_EVENTS.stockUpsert).pipe(map((stock) => inventoryStockUpsert({ stock }))),
              on<{ id: string; compartmentId: string; articleId: string }>(INVENTORY_SOCKET_EVENTS.stockRemoved).pipe(
                map((payload) => inventoryStockRemoved(payload)),
              ),
              on<never>(INVENTORY_SOCKET_EVENTS.movementCreated).pipe(
                map((movement) => inventoryMovementCreated({ movement })),
              ),
              on<never>(INVENTORY_SOCKET_EVENTS.requestUpsert).pipe(
                map((request) => inventoryRequestUpsert({ request })),
              ),
              on<{ pendingCount: number }>(INVENTORY_SOCKET_EVENTS.requestsChanged).pipe(
                map(({ pendingCount }) => inventoryRequestsChanged({ pendingCount })),
              ),
              on<never>(INVENTORY_SOCKET_EVENTS.lendingUpsert).pipe(
                map((lending) => inventoryLendingUpsert({ lending })),
              ),
              on<{ articleId: string }>(INVENTORY_SOCKET_EVENTS.serialUnitsChanged).pipe(
                map(({ articleId }) => inventorySerialUnitsChanged({ articleId })),
              ),
            ).pipe(
              catchError((error: Error) =>
                of(inventorySocketStatus({ connected: false, error: error.message || 'Connection error' })),
              ),
            );
          }),
        );
      }),
    ),
  { functional: true },
);

export const disconnectInventorySocket$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(disconnectInventorySocket),
      tap(() => {
        inventorySocket?.disconnect();
        inventorySocket = null;
      }),
      map(() => inventorySocketStatus({ connected: false })),
    ),
  { functional: true },
);

/** Live events that add / move rows (not patchable in place) reload the affected open pages. */
export const reloadInventoryOnLiveChange$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(
        inventoryWarehouseUpsert,
        inventoryCompartmentUpsert,
        inventoryCompartmentRemoved,
        inventoryArticleUpsert,
        inventoryStockUpsert,
        inventoryStockRemoved,
        inventoryMovementCreated,
        inventoryRequestUpsert,
        inventoryRequestsChanged,
        inventoryLendingUpsert,
        inventorySerialUnitsChanged,
      ),
      withLatestFrom(store.select(selectInventoryState)),
      map(([action, state]) => {
        switch (action.type) {
          case inventoryWarehouseUpsert.type:
            return inventorySlicesAffectedBy(state, { kind: 'warehouse', id: action.warehouse.id });
          case inventoryCompartmentUpsert.type:
            return inventorySlicesAffectedBy(state, {
              kind: 'compartment',
              id: action.compartment.id,
              warehouseId: action.compartment.warehouseId,
            });
          case inventoryCompartmentRemoved.type:
            return state.compartments.scopeId === action.warehouseId ? (['compartments'] as const) : [];
          case inventoryArticleUpsert.type:
            return inventorySlicesAffectedBy(state, { kind: 'article', id: action.article.id });
          case inventoryStockUpsert.type:
            return inventorySlicesAffectedBy(state, {
              kind: 'stock',
              id: action.stock.id,
              compartmentId: action.stock.compartment.id,
              articleId: action.stock.article.id,
            });
          case inventoryStockRemoved.type:
            return [
              ...(state.compartmentStock.scopeId === action.compartmentId ? (['compartmentStock'] as const) : []),
              ...(state.articleStock.scopeId === action.articleId ? (['articleStock'] as const) : []),
            ];
          case inventoryMovementCreated.type:
            return inventorySlicesAffectedBy(state, {
              kind: 'movement',
              articleId: action.movement.articleId,
              compartmentIds: [],
            });
          case inventoryRequestUpsert.type:
            return inventorySlicesAffectedBy(state, { kind: 'request', id: action.request.id });
          case inventoryLendingUpsert.type:
            return inventorySlicesAffectedBy(state, { kind: 'lending', id: action.lending.id });
          case inventorySerialUnitsChanged.type:
            return inventorySlicesAffectedBy(state, { kind: 'serialUnits', articleId: action.articleId });
          default:
            return ['requests'] as const;
        }
      }),
      map((slices) => reloadInventorySlices({ slices: [...slices] })),
    ),
  { functional: true },
);
