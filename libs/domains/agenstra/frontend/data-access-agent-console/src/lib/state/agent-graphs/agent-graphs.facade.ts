import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  clearAgentGraphNodeDetail,
  clearAgentGraphSearch,
  clearAgentGraphsError,
  expandAgentGraphNeighbors,
  loadAgentGraphDocument,
  loadAgentGraphNodeDetail,
  loadAgentGraphOverview,
  loadAgentGraphReferences,
  loadAgentGraphStatus,
  loadGlobalAgentGraph,
  loadGlobalAgentGraphStatus,
  loadWorkspaceAgentGraph,
  refreshAgentGraph,
  refreshWorkspaceGraphSnapshot,
  searchAgentGraph,
} from './agent-graphs.actions';
import {
  selectAgentGraphDocument,
  selectAgentGraphDocumentError,
  selectAgentGraphDocumentKey,
  selectAgentGraphDocumentLoading,
  selectAgentGraphDocumentLoadingMore,
  selectAgentGraphDocumentNodeTypes,
  selectAgentGraphGlobalStatuses,
  selectAgentGraphGlobalStatusLoading,
  selectAgentGraphNeighborsLoading,
  selectAgentGraphNodeDetail,
  selectAgentGraphNodeDetailError,
  selectAgentGraphNodeDetailLoading,
  selectAgentGraphOverview,
  selectAgentGraphOverviewLoading,
  selectAgentGraphReferences,
  selectAgentGraphReferencesLoading,
  selectAgentGraphRefreshing,
  selectAgentGraphRefreshingKey,
  selectAgentGraphSearch,
  selectAgentGraphSearchLoading,
  selectAgentGraphSnapshotRefreshing,
  selectAgentGraphSnapshotStatus,
  selectAgentGraphStatus,
  selectAgentGraphStatusLoading,
  selectAgentGraphsError,
} from './agent-graphs.selectors';
import type {
  AgentGraphDocument,
  AgentGraphQueryLayer,
  AgentGraphNodeDetailEntry,
  AgentGraphNodeType,
  AgentGraphOverview,
  AgentGraphReferencesResponse,
  AgentGraphSearchResponse,
  AgentGraphStatus,
  AgentGraphViewLayer,
  AgentGraphWorkspaceSnapshotStatus,
} from './agent-graphs.types';

@Injectable({
  providedIn: 'root',
})
export class AgentGraphsFacade {
  private readonly store = inject(Store);

  readonly documentKey$: Observable<string | null> = this.store.select(selectAgentGraphDocumentKey);
  readonly document$: Observable<AgentGraphDocument | null> = this.store.select(selectAgentGraphDocument);
  readonly documentLoading$: Observable<boolean> = this.store.select(selectAgentGraphDocumentLoading);
  readonly documentLoadingMore$: Observable<boolean> = this.store.select(selectAgentGraphDocumentLoadingMore);
  readonly documentError$: Observable<string | null> = this.store.select(selectAgentGraphDocumentError);
  readonly documentNodeTypes$: Observable<{ type: AgentGraphNodeType; count: number }[]> = this.store.select(
    selectAgentGraphDocumentNodeTypes,
  );
  readonly neighborsLoading$: Observable<boolean> = this.store.select(selectAgentGraphNeighborsLoading);
  readonly status$: Observable<AgentGraphStatus | null> = this.store.select(selectAgentGraphStatus);
  readonly statusLoading$: Observable<boolean> = this.store.select(selectAgentGraphStatusLoading);
  readonly overview$: Observable<AgentGraphOverview | null> = this.store.select(selectAgentGraphOverview);
  readonly overviewLoading$: Observable<boolean> = this.store.select(selectAgentGraphOverviewLoading);
  readonly refreshingKey$: Observable<string | null> = this.store.select(selectAgentGraphRefreshingKey);
  readonly nodeDetail$: Observable<AgentGraphNodeDetailEntry | null> = this.store.select(selectAgentGraphNodeDetail);
  readonly nodeDetailLoading$: Observable<boolean> = this.store.select(selectAgentGraphNodeDetailLoading);
  readonly nodeDetailError$: Observable<string | null> = this.store.select(selectAgentGraphNodeDetailError);
  readonly search$: Observable<AgentGraphSearchResponse | null> = this.store.select(selectAgentGraphSearch);
  readonly searchLoading$: Observable<boolean> = this.store.select(selectAgentGraphSearchLoading);
  readonly references$: Observable<AgentGraphReferencesResponse | null> = this.store.select(selectAgentGraphReferences);
  readonly referencesLoading$: Observable<boolean> = this.store.select(selectAgentGraphReferencesLoading);
  readonly snapshotStatus$: Observable<AgentGraphWorkspaceSnapshotStatus | null> =
    this.store.select(selectAgentGraphSnapshotStatus);
  readonly snapshotRefreshing$: Observable<boolean> = this.store.select(selectAgentGraphSnapshotRefreshing);
  readonly globalStatuses$: Observable<AgentGraphWorkspaceSnapshotStatus[]> =
    this.store.select(selectAgentGraphGlobalStatuses);
  readonly globalStatusLoading$: Observable<boolean> = this.store.select(selectAgentGraphGlobalStatusLoading);
  readonly error$: Observable<string | null> = this.store.select(selectAgentGraphsError);

  refreshing$(clientId: string, agentId: string): Observable<boolean> {
    return this.store.select(selectAgentGraphRefreshing(clientId, agentId));
  }

  loadDocument(
    clientId: string,
    agentId: string,
    layer: AgentGraphQueryLayer,
    options: { limit?: number; types?: AgentGraphNodeType[] } = {},
  ): void {
    this.store.dispatch(loadAgentGraphDocument({ clientId, agentId, layer, ...options }));
  }

  loadWorkspace(clientId: string, layer: AgentGraphViewLayer, options: { limit?: number } = {}): void {
    this.store.dispatch(loadWorkspaceAgentGraph({ clientId, layer, ...options }));
  }

  /** Rebuilds the workspace's metadata snapshot, then reloads its graph of `layer`. */
  refreshSnapshot(clientId: string, layer: AgentGraphViewLayer, options: { limit?: number } = {}): void {
    this.store.dispatch(refreshWorkspaceGraphSnapshot({ clientId, layer, ...options }));
  }

  loadGlobal(layer: AgentGraphViewLayer, options: { limit?: number } = {}): void {
    this.store.dispatch(loadGlobalAgentGraph({ layer, ...options }));
  }

  loadGlobalStatus(): void {
    this.store.dispatch(loadGlobalAgentGraphStatus());
  }

  loadStatus(clientId: string, agentId: string): void {
    this.store.dispatch(loadAgentGraphStatus({ clientId, agentId }));
  }

  loadOverview(clientId: string, agentId: string): void {
    this.store.dispatch(loadAgentGraphOverview({ clientId, agentId }));
  }

  /** Queues a rebuild; the status is polled and the document reloaded once the build finished. */
  refresh(clientId: string, agentId: string, layer: AgentGraphQueryLayer, options: { limit?: number } = {}): void {
    this.store.dispatch(refreshAgentGraph({ clientId, agentId, layer, ...options }));
  }

  loadNodeDetail(clientId: string, agentId: string, layer: AgentGraphQueryLayer, nodeId: string): void {
    this.store.dispatch(loadAgentGraphNodeDetail({ clientId, agentId, layer, nodeId }));
  }

  clearNodeDetail(): void {
    this.store.dispatch(clearAgentGraphNodeDetail());
  }

  expandNeighbors(
    clientId: string,
    agentId: string,
    layer: AgentGraphQueryLayer,
    nodeId: string,
    options: { depth?: number; limit?: number } = {},
  ): void {
    this.store.dispatch(
      expandAgentGraphNeighbors({ clientId, agentId, layer, nodeId, depth: options.depth ?? 1, limit: options.limit }),
    );
  }

  search(
    clientId: string,
    agentId: string,
    query: string,
    options: { layer?: AgentGraphQueryLayer; types?: AgentGraphNodeType[]; limit?: number } = {},
  ): void {
    this.store.dispatch(searchAgentGraph({ clientId, agentId, query, ...options }));
  }

  clearSearch(): void {
    this.store.dispatch(clearAgentGraphSearch());
  }

  loadReferences(clientId: string, agentId: string, options: { promptId?: string; limit?: number } = {}): void {
    this.store.dispatch(loadAgentGraphReferences({ clientId, agentId, ...options }));
  }

  clearError(): void {
    this.store.dispatch(clearAgentGraphsError());
  }
}
