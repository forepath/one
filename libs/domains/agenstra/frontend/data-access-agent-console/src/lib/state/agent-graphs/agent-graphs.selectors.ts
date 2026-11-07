import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AgentGraphsState } from './agent-graphs.reducer';
import { agentGraphEnvironmentKey, type AgentGraphNodeType } from './agent-graphs.types';

export const selectAgentGraphsState = createFeatureSelector<AgentGraphsState>('agentGraphs');

export const selectAgentGraphDocumentKey = createSelector(selectAgentGraphsState, (s) => s.documentKey);

export const selectAgentGraphDocument = createSelector(selectAgentGraphsState, (s) => s.document);

export const selectAgentGraphDocumentLoading = createSelector(selectAgentGraphsState, (s) => s.documentLoading);

export const selectAgentGraphDocumentError = createSelector(selectAgentGraphsState, (s) => s.documentError);

export const selectAgentGraphNeighborsLoading = createSelector(selectAgentGraphsState, (s) => s.neighborsLoading);

export const selectAgentGraphStatus = createSelector(selectAgentGraphsState, (s) => s.status);

export const selectAgentGraphStatusLoading = createSelector(selectAgentGraphsState, (s) => s.statusLoading);

export const selectAgentGraphOverview = createSelector(selectAgentGraphsState, (s) => s.overview);

export const selectAgentGraphOverviewLoading = createSelector(selectAgentGraphsState, (s) => s.overviewLoading);

export const selectAgentGraphRefreshingKey = createSelector(selectAgentGraphsState, (s) => s.refreshingKey);

export const selectAgentGraphNodeDetail = createSelector(selectAgentGraphsState, (s) => s.nodeDetail);

export const selectAgentGraphNodeDetailLoading = createSelector(selectAgentGraphsState, (s) => s.nodeDetailLoading);

export const selectAgentGraphNodeDetailError = createSelector(selectAgentGraphsState, (s) => s.nodeDetailError);

export const selectAgentGraphSearch = createSelector(selectAgentGraphsState, (s) => s.search);

export const selectAgentGraphSearchLoading = createSelector(selectAgentGraphsState, (s) => s.searchLoading);

export const selectAgentGraphReferences = createSelector(selectAgentGraphsState, (s) => s.references);

export const selectAgentGraphReferencesLoading = createSelector(selectAgentGraphsState, (s) => s.referencesLoading);

export const selectAgentGraphSnapshotStatus = createSelector(selectAgentGraphsState, (s) => s.snapshotStatus);

export const selectAgentGraphSnapshotRefreshing = createSelector(selectAgentGraphsState, (s) => s.snapshotRefreshing);

export const selectAgentGraphGlobalStatuses = createSelector(selectAgentGraphsState, (s) => s.globalStatuses);

export const selectAgentGraphGlobalStatusLoading = createSelector(selectAgentGraphsState, (s) => s.globalStatusLoading);

export const selectAgentGraphsError = createSelector(selectAgentGraphsState, (s) => s.error);

/** Node types present in the current document, most frequent first. */
export const selectAgentGraphDocumentNodeTypes = createSelector(selectAgentGraphDocument, (document) => {
  const counts = new Map<AgentGraphNodeType, number>();

  for (const node of document?.nodes ?? []) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => ({ type, count }));
});

/** True while the rebuild of this environment is requested / polled. */
export const selectAgentGraphRefreshing = (clientId: string, agentId: string) =>
  createSelector(selectAgentGraphRefreshingKey, (key) => key === agentGraphEnvironmentKey(clientId, agentId));

export const selectAgentGraphDocumentLoadingMore = createSelector(
  selectAgentGraphsState,
  (state) => state.documentLoadingMore,
);
