import { inject, Injectable } from '@angular/core';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';

import { ConsoleEndpointService } from '../../services/console-endpoint.service';
import type {
  CreateFleetCluster,
  CreateFleetOperation,
  FleetAuditFilter,
  PutFleetGrant,
  TestFleetConnection,
  UpdateFleetCluster,
} from '../../types/fleet.types';
import {
  cancelFleetOperation,
  clearFleetComparison,
  createFleetOperation,
  createFleetOperationSuccess,
  deleteFleetCluster,
  deleteFleetClusterSuccess,
  deleteFleetGrant,
  fleetClusterSwitched,
  loadFleetCloudStatus,
  loadFleetClusters,
  loadFleetComparison,
  loadFleetGrants,
  loadFleetOperations,
  loadFleetOverview,
  nextFleetAuditPage,
  openFleetCluster,
  pollFleetCluster,
  previousFleetAuditPage,
  putFleetGrant,
  putFleetGrantSuccess,
  resetFleetClusterForm,
  resetFleetOperationForm,
  saveFleetCluster,
  saveFleetClusterSuccess,
  searchFleetAudit,
  testFleetConnection,
} from './fleet.actions';
import * as s from './fleet.selectors';

/** The fleet views (3.24 / 3.25) and the active cluster of the fleet mode. */
@Injectable()
export class ConsoleFleetFacade {
  private readonly store = inject(Store);
  private readonly actions$ = inject(Actions);
  private readonly endpoints = inject(ConsoleEndpointService);

  readonly fleetMode = this.endpoints.fleetMode;
  readonly activeClusterId = this.endpoints.activeClusterId;

  readonly clusters$ = this.store.select(s.selectFleetClusters);
  readonly clustersLoaded$ = this.store.select(s.selectFleetClustersLoaded);
  readonly clustersLoading$ = this.store.select(s.selectFleetClustersLoading);
  readonly clustersError$ = this.store.select(s.selectFleetClustersError);
  readonly saving$ = this.store.select(s.selectFleetSaving);
  readonly saveError$ = this.store.select(s.selectFleetSaveError);
  readonly testing$ = this.store.select(s.selectFleetTesting);
  readonly testResult$ = this.store.select(s.selectFleetTestResult);
  readonly testError$ = this.store.select(s.selectFleetTestError);
  readonly polling$ = this.store.select(s.selectFleetPolling);
  readonly pollError$ = this.store.select(s.selectFleetPollError);

  readonly grants$ = this.store.select(s.selectFleetGrants);
  readonly grantsLoading$ = this.store.select(s.selectFleetGrantsLoading);
  readonly grantsError$ = this.store.select(s.selectFleetGrantsError);
  readonly grantSaving$ = this.store.select(s.selectFleetGrantSaving);
  readonly grantError$ = this.store.select(s.selectFleetGrantError);

  readonly cards$ = this.store.select(s.selectFleetCards);
  readonly cardsLoading$ = this.store.select(s.selectFleetCardsLoading);
  readonly cardsError$ = this.store.select(s.selectFleetCardsError);
  readonly inbox$ = this.store.select(s.selectFleetInbox);
  readonly inboxLoading$ = this.store.select(s.selectFleetInboxLoading);
  readonly inboxError$ = this.store.select(s.selectFleetInboxError);
  readonly sites$ = this.store.select(s.selectFleetSites);
  readonly sitesError$ = this.store.select(s.selectFleetSitesError);
  readonly summary$ = this.store.select(s.selectFleetSummary);

  readonly comparison$ = this.store.select(s.selectFleetComparison);
  readonly comparisonLoading$ = this.store.select(s.selectFleetComparisonLoading);
  readonly comparisonError$ = this.store.select(s.selectFleetComparisonError);

  readonly operations$ = this.store.select(s.selectFleetOperations);
  readonly operationsLoading$ = this.store.select(s.selectFleetOperationsLoading);
  readonly operationsError$ = this.store.select(s.selectFleetOperationsError);
  readonly operationSaving$ = this.store.select(s.selectFleetOperationSaving);
  readonly operationError$ = this.store.select(s.selectFleetOperationError);
  readonly cancelling$ = this.store.select(s.selectFleetCancelling);
  readonly hasActiveOperations$ = this.store.select(s.selectFleetHasActiveOperations);

  readonly cloudStatus$ = this.store.select(s.selectFleetCloudStatus);
  readonly cloudErrors$ = this.store.select(s.selectFleetCloudErrors);

  readonly auditEntries$ = this.store.select(s.selectFleetAuditEntries);
  readonly auditPage$ = this.store.select(s.selectFleetAuditPage);
  readonly auditHasNext$ = this.store.select(s.selectFleetAuditHasNext);
  readonly auditHasPrevious$ = this.store.select(s.selectFleetAuditHasPrevious);
  readonly auditLoading$ = this.store.select(s.selectFleetAuditLoading);
  readonly auditError$ = this.store.select(s.selectFleetAuditError);

  /** A connection was registered or changed (modals close on it). */
  readonly clusterSaved$ = this.actions$.pipe(ofType(saveFleetClusterSuccess));
  readonly clusterDeleted$ = this.actions$.pipe(ofType(deleteFleetClusterSuccess));
  readonly grantSaved$ = this.actions$.pipe(ofType(putFleetGrantSuccess));
  readonly operationCreated$ = this.actions$.pipe(ofType(createFleetOperationSuccess));

  loadClusters(): void {
    this.store.dispatch(loadFleetClusters());
  }

  createCluster(create: CreateFleetCluster): void {
    this.store.dispatch(saveFleetCluster({ id: null, create }));
  }

  updateCluster(id: string, update: UpdateFleetCluster): void {
    this.store.dispatch(saveFleetCluster({ id, update }));
  }

  deleteCluster(id: string): void {
    this.store.dispatch(deleteFleetCluster({ id }));
  }

  testConnection(connection: TestFleetConnection): void {
    this.store.dispatch(testFleetConnection({ connection }));
  }

  resetClusterForm(): void {
    this.store.dispatch(resetFleetClusterForm());
  }

  pollCluster(id: string): void {
    this.store.dispatch(pollFleetCluster({ id }));
  }

  loadGrants(clusterId: string): void {
    this.store.dispatch(loadFleetGrants({ clusterId }));
  }

  putGrant(clusterId: string, grant: PutFleetGrant): void {
    this.store.dispatch(putFleetGrant({ clusterId, grant }));
  }

  deleteGrant(clusterId: string, grantId: string): void {
    this.store.dispatch(deleteFleetGrant({ clusterId, grantId }));
  }

  loadOverview(): void {
    this.store.dispatch(loadFleetOverview());
  }

  compare(clusterIds: string[]): void {
    this.store.dispatch(loadFleetComparison({ clusterIds }));
  }

  clearComparison(): void {
    this.store.dispatch(clearFleetComparison());
  }

  loadOperations(cluster: string | null = null): void {
    this.store.dispatch(loadFleetOperations({ cluster }));
  }

  createOperation(operation: CreateFleetOperation): void {
    this.store.dispatch(createFleetOperation({ operation }));
  }

  resetOperationForm(): void {
    this.store.dispatch(resetFleetOperationForm());
  }

  cancelOperation(id: string): void {
    this.store.dispatch(cancelFleetOperation({ id }));
  }

  loadCloudStatus(reference: string): void {
    this.store.dispatch(loadFleetCloudStatus({ reference }));
  }

  searchAudit(filter: FleetAuditFilter, limit = 50): void {
    this.store.dispatch(searchFleetAudit({ filter, limit }));
  }

  nextAuditPage(): void {
    this.store.dispatch(nextFleetAuditPage());
  }

  previousAuditPage(): void {
    this.store.dispatch(previousFleetAuditPage());
  }

  /** Back to the fleet level: no active cluster, cluster-scoped state cleared. */
  leaveCluster(): void {
    if (this.endpoints.activeClusterId() === null) return;

    this.endpoints.setActiveCluster(null);
    this.store.dispatch(fleetClusterSwitched({ clusterId: null }));
  }

  /** Work on a cluster through the relay and open `path` in it (default: its overview). */
  openCluster(clusterId: string, path = '/'): void {
    this.store.dispatch(openFleetCluster({ clusterId, path }));
  }
}
