import { createReducer, on } from '@ngrx/store';

import type {
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
} from '../../types/fleet.types';
import {
  cancelFleetOperation,
  cancelFleetOperationFailure,
  cancelFleetOperationSuccess,
  clearFleetComparison,
  createFleetOperation,
  createFleetOperationFailure,
  createFleetOperationSuccess,
  deleteFleetCluster,
  deleteFleetClusterFailure,
  deleteFleetClusterSuccess,
  deleteFleetGrant,
  deleteFleetGrantFailure,
  deleteFleetGrantSuccess,
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
  pollFleetCluster,
  pollFleetClusterFailure,
  pollFleetClusterSuccess,
  putFleetGrant,
  putFleetGrantFailure,
  putFleetGrantSuccess,
  resetFleetClusterForm,
  resetFleetOperationForm,
  saveFleetCluster,
  saveFleetClusterFailure,
  saveFleetClusterSuccess,
  searchFleetAudit,
  testFleetConnection,
  testFleetConnectionFailure,
  testFleetConnectionSuccess,
} from './fleet.actions';

export interface ConsoleFleetState {
  clusters: FleetCluster[];
  clustersLoaded: boolean;
  clustersLoading: boolean;
  clustersError: string | null;
  /** Register / change / delete of a connection. */
  saving: boolean;
  saveError: string | null;
  testing: boolean;
  testResult: FleetClusterHealth | null;
  testError: string | null;
  /** Clusters with a health poll in flight. */
  polling: string[];
  pollError: string | null;

  grantsClusterId: string | null;
  grants: FleetGrant[];
  grantsLoading: boolean;
  grantsError: string | null;
  grantSaving: boolean;
  grantError: string | null;

  cards: FleetCard[];
  cardsLoading: boolean;
  cardsError: string | null;
  inbox: FleetInboxItem[];
  inboxLoading: boolean;
  inboxError: string | null;
  sites: FleetSites | null;
  sitesLoading: boolean;
  sitesError: string | null;

  comparison: FleetComparison | null;
  comparisonLoading: boolean;
  comparisonError: string | null;

  operationsCluster: string | null;
  operations: FleetOperation[];
  operationsLoading: boolean;
  operationsError: string | null;
  operationSaving: boolean;
  operationError: string | null;
  cancelling: string[];

  cloudStatus: Record<string, FleetCloudStatus>;
  cloudErrors: Record<string, string>;

  auditFilter: FleetAuditFilter | null;
  auditLimit: number;
  auditEntries: FleetAuditEntry[];
  auditPage: number;
  /** `auditCursors[i]`: the `before` page `i` was read with (`null` for the newest). */
  auditCursors: (string | null)[];
  auditHasNext: boolean;
  auditLoading: boolean;
  auditError: string | null;
}

export const initialConsoleFleetState: ConsoleFleetState = {
  clusters: [],
  clustersLoaded: false,
  clustersLoading: false,
  clustersError: null,
  saving: false,
  saveError: null,
  testing: false,
  testResult: null,
  testError: null,
  polling: [],
  pollError: null,
  grantsClusterId: null,
  grants: [],
  grantsLoading: false,
  grantsError: null,
  grantSaving: false,
  grantError: null,
  cards: [],
  cardsLoading: false,
  cardsError: null,
  inbox: [],
  inboxLoading: false,
  inboxError: null,
  sites: null,
  sitesLoading: false,
  sitesError: null,
  comparison: null,
  comparisonLoading: false,
  comparisonError: null,
  operationsCluster: null,
  operations: [],
  operationsLoading: false,
  operationsError: null,
  operationSaving: false,
  operationError: null,
  cancelling: [],
  cloudStatus: {},
  cloudErrors: {},
  auditFilter: null,
  auditLimit: 50,
  auditEntries: [],
  auditPage: 0,
  auditCursors: [null],
  auditHasNext: false,
  auditLoading: false,
  auditError: null,
};

function replaceOperation(list: FleetOperation[], operation: FleetOperation): FleetOperation[] {
  return list.some((o) => o.id === operation.id)
    ? list.map((o) => (o.id === operation.id ? operation : o))
    : [operation, ...list];
}

export const consoleFleetReducer = createReducer(
  initialConsoleFleetState,
  on(loadFleetClusters, (state) => ({ ...state, clustersLoading: true, clustersError: null })),
  on(loadFleetClustersSuccess, (state, { clusters }) => ({
    ...state,
    clusters,
    clustersLoaded: true,
    clustersLoading: false,
  })),
  on(loadFleetClustersFailure, (state, { error }) => ({
    ...state,
    clustersLoaded: true,
    clustersLoading: false,
    clustersError: error,
  })),
  on(saveFleetCluster, deleteFleetCluster, (state) => ({ ...state, saving: true, saveError: null })),
  on(saveFleetClusterSuccess, (state, { cluster }) => ({
    ...state,
    saving: false,
    clusters: state.clusters.some((c) => c.id === cluster.id)
      ? state.clusters.map((c) => (c.id === cluster.id ? cluster : c))
      : [...state.clusters, cluster].sort((a, b) => a.name.localeCompare(b.name)),
  })),
  on(deleteFleetClusterSuccess, (state, { id }) => ({
    ...state,
    saving: false,
    clusters: state.clusters.filter((c) => c.id !== id),
    cards: state.cards.filter((c) => c.id !== id),
  })),
  on(saveFleetClusterFailure, deleteFleetClusterFailure, (state, { error }) => ({
    ...state,
    saving: false,
    saveError: error,
  })),
  on(testFleetConnection, (state) => ({ ...state, testing: true, testResult: null, testError: null })),
  on(testFleetConnectionSuccess, (state, { health }) => ({ ...state, testing: false, testResult: health })),
  on(testFleetConnectionFailure, (state, { error }) => ({ ...state, testing: false, testError: error })),
  on(resetFleetClusterForm, (state) => ({
    ...state,
    saveError: null,
    testing: false,
    testResult: null,
    testError: null,
  })),
  on(pollFleetCluster, (state, { id }) => ({ ...state, polling: [...state.polling, id], pollError: null })),
  on(pollFleetClusterSuccess, (state, { id, health }) => ({
    ...state,
    polling: state.polling.filter((p) => p !== id),
    clusters: state.clusters.map((c) => (c.id === id ? { ...c, health } : c)),
  })),
  on(pollFleetClusterFailure, (state, { id, error }) => ({
    ...state,
    polling: state.polling.filter((p) => p !== id),
    pollError: error,
  })),

  on(loadFleetGrants, (state, { clusterId }) => ({
    ...state,
    grantsClusterId: clusterId,
    grants: state.grantsClusterId === clusterId ? state.grants : [],
    grantsLoading: true,
    grantsError: null,
  })),
  on(loadFleetGrantsSuccess, (state, { clusterId, grants }) =>
    clusterId === state.grantsClusterId ? { ...state, grants, grantsLoading: false } : state,
  ),
  on(loadFleetGrantsFailure, (state, { clusterId, error }) =>
    clusterId === state.grantsClusterId ? { ...state, grantsLoading: false, grantsError: error } : state,
  ),
  on(putFleetGrant, deleteFleetGrant, (state) => ({ ...state, grantSaving: true, grantError: null })),
  on(putFleetGrantSuccess, deleteFleetGrantSuccess, (state) => ({ ...state, grantSaving: false })),
  on(putFleetGrantFailure, deleteFleetGrantFailure, (state, { error }) => ({
    ...state,
    grantSaving: false,
    grantError: error,
  })),

  on(loadFleetOverview, (state) => ({
    ...state,
    cardsLoading: true,
    cardsError: null,
    inboxLoading: true,
    inboxError: null,
    sitesLoading: true,
    sitesError: null,
  })),
  on(loadFleetCardsSuccess, (state, { cards }) => ({ ...state, cards, cardsLoading: false })),
  on(loadFleetCardsFailure, (state, { error }) => ({ ...state, cardsLoading: false, cardsError: error })),
  on(loadFleetInboxSuccess, (state, { items }) => ({ ...state, inbox: items, inboxLoading: false })),
  on(loadFleetInboxFailure, (state, { error }) => ({ ...state, inboxLoading: false, inboxError: error })),
  on(loadFleetSitesSuccess, (state, { sites }) => ({ ...state, sites, sitesLoading: false })),
  on(loadFleetSitesFailure, (state, { error }) => ({ ...state, sitesLoading: false, sitesError: error })),

  on(loadFleetComparison, (state) => ({ ...state, comparisonLoading: true, comparisonError: null })),
  on(loadFleetComparisonSuccess, (state, { comparison }) => ({ ...state, comparison, comparisonLoading: false })),
  on(loadFleetComparisonFailure, (state, { error }) => ({
    ...state,
    comparison: null,
    comparisonLoading: false,
    comparisonError: error,
  })),
  on(clearFleetComparison, (state) => ({ ...state, comparison: null, comparisonError: null })),

  on(loadFleetOperations, (state, { cluster }) => ({
    ...state,
    operationsCluster: cluster,
    operationsLoading: true,
    operationsError: null,
  })),
  on(loadFleetOperationsSuccess, (state, { operations }) => ({ ...state, operations, operationsLoading: false })),
  on(loadFleetOperationsFailure, (state, { error }) => ({
    ...state,
    operationsLoading: false,
    operationsError: error,
  })),
  on(createFleetOperation, (state) => ({ ...state, operationSaving: true, operationError: null })),
  on(createFleetOperationSuccess, (state, { operation }) => ({
    ...state,
    operationSaving: false,
    operations: replaceOperation(state.operations, operation),
  })),
  on(createFleetOperationFailure, (state, { error }) => ({
    ...state,
    operationSaving: false,
    operationError: error,
  })),
  on(resetFleetOperationForm, (state) => ({ ...state, operationError: null })),
  on(cancelFleetOperation, (state, { id }) => ({
    ...state,
    cancelling: [...state.cancelling, id],
    operationsError: null,
  })),
  on(cancelFleetOperationSuccess, (state, { operation }) => ({
    ...state,
    cancelling: state.cancelling.filter((c) => c !== operation.id),
    operations: replaceOperation(state.operations, operation),
  })),
  on(cancelFleetOperationFailure, (state, { error }) => ({
    ...state,
    cancelling: [],
    operationsError: error,
  })),

  on(loadFleetCloudStatus, (state, { reference }) => {
    const cloudErrors = { ...state.cloudErrors };

    delete cloudErrors[reference];

    return { ...state, cloudErrors };
  }),
  on(loadFleetCloudStatusSuccess, (state, { reference, status }) => ({
    ...state,
    cloudStatus: { ...state.cloudStatus, [reference]: status },
  })),
  on(loadFleetCloudStatusFailure, (state, { reference, error }) => ({
    ...state,
    cloudErrors: { ...state.cloudErrors, [reference]: error },
  })),

  on(searchFleetAudit, (state, { filter, limit }) => ({
    ...state,
    auditFilter: filter,
    auditLimit: limit,
    auditEntries: [],
    auditPage: 0,
    auditCursors: [null],
    auditHasNext: false,
    auditError: null,
  })),
  on(loadFleetAuditPage, (state, { page, before }) => {
    const auditCursors = state.auditCursors.slice(0, page);

    auditCursors[page] = before;

    return { ...state, auditPage: page, auditCursors, auditLoading: true, auditError: null };
  }),
  on(loadFleetAuditPageSuccess, (state, { page, entries }) =>
    page === state.auditPage
      ? {
          ...state,
          auditEntries: entries,
          auditHasNext: entries.length >= state.auditLimit,
          auditLoading: false,
        }
      : state,
  ),
  on(loadFleetAuditPageFailure, (state, { page, error }) =>
    page === state.auditPage
      ? { ...state, auditEntries: [], auditHasNext: false, auditLoading: false, auditError: error }
      : state,
  ),
);
