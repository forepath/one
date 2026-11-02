import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { logoutSuccess } from '@forepath/identity/frontend';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  catchError,
  concatMap,
  exhaustMap,
  filter,
  map,
  mergeMap,
  of,
  switchMap,
  tap,
  throwError,
  withLatestFrom,
} from 'rxjs';

import { ConsoleEndpointService } from '../../services/console-endpoint.service';
import { FleetService } from '../../services/fleet.service';
import type { FleetAuditFilter } from '../../types/fleet.types';
import { apiErrorMessage } from '../../utils/api-error';
import {
  cancelFleetOperation,
  cancelFleetOperationFailure,
  cancelFleetOperationSuccess,
  createFleetOperation,
  createFleetOperationFailure,
  createFleetOperationSuccess,
  deleteFleetCluster,
  deleteFleetClusterFailure,
  deleteFleetClusterSuccess,
  deleteFleetGrant,
  deleteFleetGrantFailure,
  deleteFleetGrantSuccess,
  fleetClusterSwitched,
  loadFleetAuditPage,
  loadFleetAuditPageFailure,
  loadFleetAuditPageSuccess,
  loadFleetCardsFailure,
  loadFleetCardsSuccess,
  loadFleetCloudStatus,
  loadFleetCloudStatusFailure,
  loadFleetCloudStatusSuccess,
  loadFleetClusters,
  loadFleetClustersFailure,
  loadFleetClustersSuccess,
  loadFleetComparison,
  loadFleetComparisonFailure,
  loadFleetComparisonSuccess,
  loadFleetGrants,
  loadFleetGrantsFailure,
  loadFleetGrantsSuccess,
  loadFleetInboxFailure,
  loadFleetInboxSuccess,
  loadFleetOperations,
  loadFleetOperationsFailure,
  loadFleetOperationsSuccess,
  loadFleetOverview,
  loadFleetSitesFailure,
  loadFleetSitesSuccess,
  nextFleetAuditPage,
  openFleetCluster,
  pollFleetCluster,
  pollFleetClusterFailure,
  pollFleetClusterSuccess,
  previousFleetAuditPage,
  putFleetGrant,
  putFleetGrantFailure,
  putFleetGrantSuccess,
  saveFleetCluster,
  saveFleetClusterFailure,
  saveFleetClusterSuccess,
  searchFleetAudit,
  testFleetConnection,
  testFleetConnectionFailure,
  testFleetConnectionSuccess,
} from './fleet.actions';
import { selectConsoleFleetState } from './fleet.selectors';

const fail = (error: unknown, fallback: string) => apiErrorMessage(error, fallback);

export const loadFleetClusters$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(loadFleetClusters),
      switchMap(() =>
        service.clusters().pipe(
          map((clusters) => loadFleetClustersSuccess({ clusters })),
          catchError((error: unknown) =>
            of(loadFleetClustersFailure({ error: fail(error, 'Failed to load the clusters') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const saveFleetCluster$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(saveFleetCluster),
      exhaustMap(({ id, create, update }) =>
        (id
          ? service.updateCluster(id, update ?? {})
          : create
            ? service.createCluster(create)
            : throwError(() => new Error('Nothing to register'))
        ).pipe(
          map((cluster) => saveFleetClusterSuccess({ cluster })),
          catchError((error: unknown) =>
            of(saveFleetClusterFailure({ error: fail(error, 'Failed to save the cluster') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const deleteFleetCluster$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(deleteFleetCluster),
      exhaustMap(({ id }) =>
        service.deleteCluster(id).pipe(
          map(() => deleteFleetClusterSuccess({ id })),
          catchError((error: unknown) =>
            of(deleteFleetClusterFailure({ error: fail(error, 'Failed to remove the cluster') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const testFleetConnection$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(testFleetConnection),
      switchMap(({ connection }) =>
        service.testConnection(connection).pipe(
          map((health) => testFleetConnectionSuccess({ health })),
          catchError((error: unknown) =>
            of(testFleetConnectionFailure({ error: fail(error, 'The connection test failed') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const pollFleetCluster$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(pollFleetCluster),
      mergeMap(({ id }) =>
        service.pollCluster(id).pipe(
          map((health) => pollFleetClusterSuccess({ id, health })),
          catchError((error: unknown) =>
            of(pollFleetClusterFailure({ id, error: fail(error, 'Failed to check the cluster') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadFleetGrants$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(loadFleetGrants),
      switchMap(({ clusterId }) =>
        service.grants(clusterId).pipe(
          map((grants) => loadFleetGrantsSuccess({ clusterId, grants })),
          catchError((error: unknown) =>
            of(loadFleetGrantsFailure({ clusterId, error: fail(error, 'Failed to load the grants') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const putFleetGrant$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(putFleetGrant),
      concatMap(({ clusterId, grant }) =>
        service.putGrant(clusterId, grant).pipe(
          map((saved) => putFleetGrantSuccess({ grant: saved })),
          catchError((error: unknown) => of(putFleetGrantFailure({ error: fail(error, 'Failed to save the grant') }))),
        ),
      ),
    ),
  { functional: true },
);

export const deleteFleetGrant$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(deleteFleetGrant),
      concatMap(({ clusterId, grantId }) =>
        service.deleteGrant(clusterId, grantId).pipe(
          map(() => deleteFleetGrantSuccess({ clusterId, grantId })),
          catchError((error: unknown) =>
            of(deleteFleetGrantFailure({ error: fail(error, 'Failed to remove the grant') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** The grant list again after a change. */
export const reloadFleetGrants$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(putFleetGrantSuccess, deleteFleetGrantSuccess),
      map((action) => loadFleetGrants({ clusterId: 'grant' in action ? action.grant.clusterId : action.clusterId })),
    ),
  { functional: true },
);

export const loadFleetCards$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(loadFleetOverview),
      switchMap(() =>
        service.cards().pipe(
          map((cards) => loadFleetCardsSuccess({ cards })),
          catchError((error: unknown) =>
            of(loadFleetCardsFailure({ error: fail(error, 'Failed to load the clusters') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadFleetInbox$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(loadFleetOverview),
      switchMap(() =>
        service.inbox().pipe(
          map((items) => loadFleetInboxSuccess({ items })),
          catchError((error: unknown) => of(loadFleetInboxFailure({ error: fail(error, 'Failed to load the inbox') }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadFleetSites$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(loadFleetOverview),
      switchMap(() =>
        service.sites().pipe(
          map((sites) => loadFleetSitesSuccess({ sites })),
          catchError((error: unknown) => of(loadFleetSitesFailure({ error: fail(error, 'Failed to load the sites') }))),
        ),
      ),
    ),
  { functional: true },
);

export const loadFleetComparison$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(loadFleetComparison),
      switchMap(({ clusterIds }) =>
        service.compare(clusterIds).pipe(
          map((comparison) => loadFleetComparisonSuccess({ comparison })),
          catchError((error: unknown) =>
            of(loadFleetComparisonFailure({ error: fail(error, 'Failed to compare the clusters') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadFleetOperations$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(loadFleetOperations),
      switchMap(({ cluster }) =>
        service.operations({ ...(cluster ? { cluster } : {}), limit: 100 }).pipe(
          map((operations) => loadFleetOperationsSuccess({ operations })),
          catchError((error: unknown) =>
            of(loadFleetOperationsFailure({ error: fail(error, 'Failed to load the operations') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const createFleetOperation$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(createFleetOperation),
      exhaustMap(({ operation }) =>
        service.createOperation(operation).pipe(
          map((created) => createFleetOperationSuccess({ operation: created })),
          catchError((error: unknown) =>
            of(createFleetOperationFailure({ error: fail(error, 'Failed to start the operation') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const cancelFleetOperation$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(cancelFleetOperation),
      mergeMap(({ id }) =>
        service.cancelOperation(id).pipe(
          map((operation) => cancelFleetOperationSuccess({ operation })),
          catchError((error: unknown) =>
            of(cancelFleetOperationFailure({ error: fail(error, 'Failed to cancel the operation') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadFleetCloudStatus$ = createEffect(
  (actions$ = inject(Actions), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(loadFleetCloudStatus),
      mergeMap(({ reference }) =>
        service.cloudStatus(reference).pipe(
          map((status) => loadFleetCloudStatusSuccess({ reference, status })),
          catchError((error: unknown) =>
            of(loadFleetCloudStatusFailure({ reference, error: fail(error, 'Failed to load the Cloud status') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const searchFleetAudit$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(searchFleetAudit),
      map(() => loadFleetAuditPage({ page: 0, before: null })),
    ),
  { functional: true },
);

export const fleetAuditPageNavigation$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(nextFleetAuditPage, previousFleetAuditPage),
      withLatestFrom(store.select(selectConsoleFleetState)),
      filter(([action, state]) =>
        action.type === nextFleetAuditPage.type
          ? state.auditHasNext && !state.auditLoading && state.auditEntries.length > 0
          : state.auditPage > 0,
      ),
      map(([action, state]) =>
        action.type === nextFleetAuditPage.type
          ? loadFleetAuditPage({
              page: state.auditPage + 1,
              before: state.auditEntries[state.auditEntries.length - 1].seq,
            })
          : loadFleetAuditPage({ page: state.auditPage - 1, before: state.auditCursors[state.auditPage - 1] ?? null }),
      ),
    ),
  { functional: true },
);

export const loadFleetAuditPage$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), service = inject(FleetService)) =>
    actions$.pipe(
      ofType(loadFleetAuditPage),
      withLatestFrom(store.select(selectConsoleFleetState)),
      filter(([, state]) => state.auditFilter !== null),
      switchMap(([{ page, before }, state]) =>
        service.audit(state.auditFilter as FleetAuditFilter, state.auditLimit, before).pipe(
          map((entries) => loadFleetAuditPageSuccess({ page, entries })),
          catchError((error: unknown) =>
            of(loadFleetAuditPageFailure({ page, error: fail(error, 'Failed to load the fleet audit log') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/**
 * Opens a cluster through the relay: the endpoint switches to its relay, every cluster-scoped slice is reset
 * (`fleetClusterSwitched`), then the console navigates to the page (`/` = the landing page, or a link of the merged inbox).
 */
export const openFleetCluster$ = createEffect(
  (
    actions$ = inject(Actions),
    store = inject(Store),
    endpoints = inject(ConsoleEndpointService),
    router = inject(Router),
  ) =>
    actions$.pipe(
      ofType(openFleetCluster),
      tap(({ clusterId, path }) => {
        if (endpoints.activeClusterId() !== clusterId) {
          endpoints.setActiveCluster(clusterId);
          // Before navigating: the next page must not see the previous cluster's state.
          store.dispatch(fleetClusterSwitched({ clusterId }));
        }

        void router.navigateByUrl(path.startsWith('/') ? path : `/${path}`);
      }),
    ),
  { functional: true, dispatch: false },
);

/** Signing out leaves the active cluster (the next user starts at the fleet overview). */
export const leaveFleetClusterOnLogout$ = createEffect(
  (actions$ = inject(Actions), endpoints = inject(ConsoleEndpointService)) =>
    actions$.pipe(
      ofType(logoutSuccess),
      tap(() => endpoints.setActiveCluster(null)),
    ),
  { functional: true, dispatch: false },
);
