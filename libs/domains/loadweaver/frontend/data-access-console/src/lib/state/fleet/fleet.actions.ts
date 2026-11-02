import { createAction, props } from '@ngrx/store';

import type {
  CreateFleetCluster,
  CreateFleetOperation,
  FleetAuditEntry,
  FleetAuditFilter,
  FleetCard,
  FleetCloudStatus,
  FleetCluster,
  FleetClusterHealth,
  FleetComparison,
  FleetGrant,
  FleetInboxItem,
  FleetOperation,
  FleetSites,
  PutFleetGrant,
  TestFleetConnection,
  UpdateFleetCluster,
} from '../../types/fleet.types';

// ------------------------------------------------------------------------------------------------- clusters
export const loadFleetClusters = createAction('[ConsoleFleet] Load Clusters');
export const loadFleetClustersSuccess = createAction(
  '[ConsoleFleet] Load Clusters Success',
  props<{ clusters: FleetCluster[] }>(),
);
export const loadFleetClustersFailure = createAction(
  '[ConsoleFleet] Load Clusters Failure',
  props<{ error: string }>(),
);

/** Register (`id: null`, `create`) or change (`id`, `update`) a connection. */
export const saveFleetCluster = createAction(
  '[ConsoleFleet] Save Cluster',
  props<{ id: string | null; create?: CreateFleetCluster; update?: UpdateFleetCluster }>(),
);
export const saveFleetClusterSuccess = createAction(
  '[ConsoleFleet] Save Cluster Success',
  props<{ cluster: FleetCluster }>(),
);
export const saveFleetClusterFailure = createAction('[ConsoleFleet] Save Cluster Failure', props<{ error: string }>());

export const deleteFleetCluster = createAction('[ConsoleFleet] Delete Cluster', props<{ id: string }>());
export const deleteFleetClusterSuccess = createAction('[ConsoleFleet] Delete Cluster Success', props<{ id: string }>());
export const deleteFleetClusterFailure = createAction(
  '[ConsoleFleet] Delete Cluster Failure',
  props<{ error: string }>(),
);

/** Probe an endpoint + credential before saving. */
export const testFleetConnection = createAction(
  '[ConsoleFleet] Test Connection',
  props<{ connection: TestFleetConnection }>(),
);
export const testFleetConnectionSuccess = createAction(
  '[ConsoleFleet] Test Connection Success',
  props<{ health: FleetClusterHealth }>(),
);
export const testFleetConnectionFailure = createAction(
  '[ConsoleFleet] Test Connection Failure',
  props<{ error: string }>(),
);
/** Clears the last probe and save error (a modal opens fresh). */
export const resetFleetClusterForm = createAction('[ConsoleFleet] Reset Cluster Form');

/** Health poll of a registered cluster now. */
export const pollFleetCluster = createAction('[ConsoleFleet] Poll Cluster', props<{ id: string }>());
export const pollFleetClusterSuccess = createAction(
  '[ConsoleFleet] Poll Cluster Success',
  props<{ id: string; health: FleetClusterHealth }>(),
);
export const pollFleetClusterFailure = createAction(
  '[ConsoleFleet] Poll Cluster Failure',
  props<{ id: string; error: string }>(),
);

// --------------------------------------------------------------------------------------------------- grants
export const loadFleetGrants = createAction('[ConsoleFleet] Load Grants', props<{ clusterId: string }>());
export const loadFleetGrantsSuccess = createAction(
  '[ConsoleFleet] Load Grants Success',
  props<{ clusterId: string; grants: FleetGrant[] }>(),
);
export const loadFleetGrantsFailure = createAction(
  '[ConsoleFleet] Load Grants Failure',
  props<{ clusterId: string; error: string }>(),
);
export const putFleetGrant = createAction(
  '[ConsoleFleet] Put Grant',
  props<{ clusterId: string; grant: PutFleetGrant }>(),
);
export const putFleetGrantSuccess = createAction('[ConsoleFleet] Put Grant Success', props<{ grant: FleetGrant }>());
export const putFleetGrantFailure = createAction('[ConsoleFleet] Put Grant Failure', props<{ error: string }>());
export const deleteFleetGrant = createAction(
  '[ConsoleFleet] Delete Grant',
  props<{ clusterId: string; grantId: string }>(),
);
export const deleteFleetGrantSuccess = createAction(
  '[ConsoleFleet] Delete Grant Success',
  props<{ clusterId: string; grantId: string }>(),
);
export const deleteFleetGrantFailure = createAction('[ConsoleFleet] Delete Grant Failure', props<{ error: string }>());

// ------------------------------------------------------------------------------------------- fleet overview
/** Cards, the merged inbox and the sites, each loaded on its own (one failing doesn't hide the others). */
export const loadFleetOverview = createAction('[ConsoleFleet] Load Overview');
export const loadFleetCardsSuccess = createAction('[ConsoleFleet] Load Cards Success', props<{ cards: FleetCard[] }>());
export const loadFleetCardsFailure = createAction('[ConsoleFleet] Load Cards Failure', props<{ error: string }>());
export const loadFleetInboxSuccess = createAction(
  '[ConsoleFleet] Load Inbox Success',
  props<{ items: FleetInboxItem[] }>(),
);
export const loadFleetInboxFailure = createAction('[ConsoleFleet] Load Inbox Failure', props<{ error: string }>());
export const loadFleetSitesSuccess = createAction('[ConsoleFleet] Load Sites Success', props<{ sites: FleetSites }>());
export const loadFleetSitesFailure = createAction('[ConsoleFleet] Load Sites Failure', props<{ error: string }>());

// -------------------------------------------------------------------------------------------------- compare
export const loadFleetComparison = createAction('[ConsoleFleet] Load Comparison', props<{ clusterIds: string[] }>());
export const loadFleetComparisonSuccess = createAction(
  '[ConsoleFleet] Load Comparison Success',
  props<{ comparison: FleetComparison }>(),
);
export const loadFleetComparisonFailure = createAction(
  '[ConsoleFleet] Load Comparison Failure',
  props<{ error: string }>(),
);
export const clearFleetComparison = createAction('[ConsoleFleet] Clear Comparison');

// ----------------------------------------------------------------------------------------------- operations
export const loadFleetOperations = createAction('[ConsoleFleet] Load Operations', props<{ cluster: string | null }>());
export const loadFleetOperationsSuccess = createAction(
  '[ConsoleFleet] Load Operations Success',
  props<{ operations: FleetOperation[] }>(),
);
export const loadFleetOperationsFailure = createAction(
  '[ConsoleFleet] Load Operations Failure',
  props<{ error: string }>(),
);
export const createFleetOperation = createAction(
  '[ConsoleFleet] Create Operation',
  props<{ operation: CreateFleetOperation }>(),
);
export const createFleetOperationSuccess = createAction(
  '[ConsoleFleet] Create Operation Success',
  props<{ operation: FleetOperation }>(),
);
export const createFleetOperationFailure = createAction(
  '[ConsoleFleet] Create Operation Failure',
  props<{ error: string }>(),
);
export const cancelFleetOperation = createAction('[ConsoleFleet] Cancel Operation', props<{ id: string }>());
export const cancelFleetOperationSuccess = createAction(
  '[ConsoleFleet] Cancel Operation Success',
  props<{ operation: FleetOperation }>(),
);
export const cancelFleetOperationFailure = createAction(
  '[ConsoleFleet] Cancel Operation Failure',
  props<{ error: string }>(),
);
/** Clears the wizard's error (it opens fresh). */
export const resetFleetOperationForm = createAction('[ConsoleFleet] Reset Operation Form');

// ---------------------------------------------------------------------------------------------------- cloud
export const loadFleetCloudStatus = createAction('[ConsoleFleet] Load Cloud Status', props<{ reference: string }>());
export const loadFleetCloudStatusSuccess = createAction(
  '[ConsoleFleet] Load Cloud Status Success',
  props<{ reference: string; status: FleetCloudStatus }>(),
);
export const loadFleetCloudStatusFailure = createAction(
  '[ConsoleFleet] Load Cloud Status Failure',
  props<{ reference: string; error: string }>(),
);

// ---------------------------------------------------------------------------------------------------- audit
export const searchFleetAudit = createAction(
  '[ConsoleFleet] Search Audit',
  props<{ filter: FleetAuditFilter; limit: number }>(),
);
export const loadFleetAuditPage = createAction(
  '[ConsoleFleet] Load Audit Page',
  props<{ page: number; before: string | null }>(),
);
export const loadFleetAuditPageSuccess = createAction(
  '[ConsoleFleet] Load Audit Page Success',
  props<{ page: number; entries: FleetAuditEntry[] }>(),
);
export const loadFleetAuditPageFailure = createAction(
  '[ConsoleFleet] Load Audit Page Failure',
  props<{ page: number; error: string }>(),
);
export const nextFleetAuditPage = createAction('[ConsoleFleet] Next Audit Page');
export const previousFleetAuditPage = createAction('[ConsoleFleet] Previous Audit Page');

// -------------------------------------------------------------------------------------- active cluster
/** Work on a cluster through the relay: sets it active, clears cluster-scoped state and navigates to `path`. */
export const openFleetCluster = createAction(
  '[ConsoleFleet] Open Cluster',
  props<{ clusterId: string; path: string }>(),
);
/**
 * The active cluster changed (or was left, `null`): every cluster-scoped `console*` slice is rebuilt from its initial
 * state (see `resetConsoleStateOnLogout`), so no data of the previous cluster stays visible.
 */
export const fleetClusterSwitched = createAction(
  '[ConsoleFleet] Cluster Switched',
  props<{ clusterId: string | null }>(),
);
