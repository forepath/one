import { createReducer, on } from '@ngrx/store';

import {
  agentGraphRefreshPollFinished,
  clearAgentGraphNodeDetail,
  clearAgentGraphSearch,
  clearAgentGraphsError,
  expandAgentGraphNeighbors,
  expandAgentGraphNeighborsFailure,
  expandAgentGraphNeighborsSuccess,
  loadAgentGraphDocument,
  loadAgentGraphDocumentFailure,
  loadAgentGraphDocumentPageSuccess,
  loadAgentGraphDocumentSuccess,
  loadAgentGraphNodeDetail,
  loadAgentGraphNodeDetailFailure,
  loadAgentGraphNodeDetailSuccess,
  loadAgentGraphOverview,
  loadAgentGraphOverviewFailure,
  loadAgentGraphOverviewSuccess,
  loadAgentGraphReferences,
  loadAgentGraphReferencesFailure,
  loadAgentGraphReferencesSuccess,
  loadAgentGraphStatus,
  loadAgentGraphStatusFailure,
  loadAgentGraphStatusSuccess,
  loadGlobalAgentGraph,
  loadGlobalAgentGraphStatus,
  loadGlobalAgentGraphStatusFailure,
  loadGlobalAgentGraphStatusSuccess,
  loadWorkspaceAgentGraph,
  refreshAgentGraph,
  refreshAgentGraphFailure,
  refreshAgentGraphSuccess,
  refreshWorkspaceGraphSnapshot,
  refreshWorkspaceGraphSnapshotFailure,
  refreshWorkspaceGraphSnapshotSuccess,
  searchAgentGraph,
  searchAgentGraphFailure,
  searchAgentGraphSuccess,
} from './agent-graphs.actions';
import {
  agentGraphDocumentKey,
  agentGraphEnvironmentKey,
  agentGraphNodeDetailKey,
  appendAgentGraphPage,
  mergeAgentGraphDocuments,
  type AgentGraphDocument,
  type AgentGraphDocumentRequest,
  type AgentGraphNodeDetailEntry,
  type AgentGraphOverview,
  type AgentGraphReferencesResponse,
  type AgentGraphSearchResponse,
  type AgentGraphStatus,
  type AgentGraphWorkspaceSnapshotStatus,
} from './agent-graphs.types';

/**
 * Lean on purpose: graphs can be large, so only the document currently viewed (plus the last node detail, search and
 * reference lists) is kept. Every slice carries the key it was requested for; late responses of an earlier view are
 * dropped.
 */
export interface AgentGraphsState {
  documentKey: string | null;
  document: AgentGraphDocument | null;
  documentLoading: boolean;
  /** More pages of the current document are being loaded ("All" node limit). */
  documentLoadingMore: boolean;
  documentError: string | null;
  neighborsLoading: boolean;
  /** `${clientId}:${agentId}` of `status` / `overview` / `references`. */
  statusKey: string | null;
  status: AgentGraphStatus | null;
  statusLoading: boolean;
  overviewKey: string | null;
  overview: AgentGraphOverview | null;
  overviewLoading: boolean;
  /** Environment whose rebuild was requested and is being polled. */
  refreshingKey: string | null;
  nodeDetailKey: string | null;
  nodeDetail: AgentGraphNodeDetailEntry | null;
  nodeDetailLoading: boolean;
  nodeDetailError: string | null;
  search: AgentGraphSearchResponse | null;
  searchLoading: boolean;
  referencesKey: string | null;
  references: AgentGraphReferencesResponse | null;
  referencesLoading: boolean;
  snapshotStatus: AgentGraphWorkspaceSnapshotStatus | null;
  snapshotRefreshing: boolean;
  globalStatuses: AgentGraphWorkspaceSnapshotStatus[];
  globalStatusLoading: boolean;
  error: string | null;
}

export const initialAgentGraphsState: AgentGraphsState = {
  documentKey: null,
  document: null,
  documentLoading: false,
  documentLoadingMore: false,
  documentError: null,
  neighborsLoading: false,
  statusKey: null,
  status: null,
  statusLoading: false,
  overviewKey: null,
  overview: null,
  overviewLoading: false,
  refreshingKey: null,
  nodeDetailKey: null,
  nodeDetail: null,
  nodeDetailLoading: false,
  nodeDetailError: null,
  search: null,
  searchLoading: false,
  referencesKey: null,
  references: null,
  referencesLoading: false,
  snapshotStatus: null,
  snapshotRefreshing: false,
  globalStatuses: [],
  globalStatusLoading: false,
  error: null,
};

/** Starts loading a document; a different view drops the previous document right away (no history). */
function startDocument(state: AgentGraphsState, request: AgentGraphDocumentRequest): AgentGraphsState {
  const key = agentGraphDocumentKey(request);

  return {
    ...state,
    documentKey: key,
    document: state.documentKey === key ? state.document : null,
    documentLoading: true,
    documentLoadingMore: false,
    documentError: null,
  };
}

export const agentGraphsReducer = createReducer(
  initialAgentGraphsState,
  on(loadAgentGraphDocument, (state, { clientId, agentId, layer, limit }) =>
    startDocument(state, { scope: 'environment', clientId, agentId, layer, limit }),
  ),
  on(loadWorkspaceAgentGraph, (state, { clientId, layer, limit }) =>
    startDocument(state, { scope: 'workspace', clientId, layer, limit }),
  ),
  on(loadGlobalAgentGraph, (state, { layer, limit }) =>
    startDocument(state, { scope: 'global', clientId: null, layer, limit }),
  ),
  // The first page is shown right away; further pages ("All") are appended while `documentLoadingMore` is set.
  on(loadAgentGraphDocumentSuccess, (state, { key, document }) =>
    state.documentKey === key
      ? {
          ...state,
          document,
          documentLoading: false,
          documentLoadingMore: document.nextOffset !== undefined && document.nextOffset !== null,
          documentError: null,
        }
      : state,
  ),
  on(loadAgentGraphDocumentPageSuccess, (state, { key, document }) =>
    state.documentKey === key && state.document
      ? {
          ...state,
          document: appendAgentGraphPage(state.document, document),
          documentLoadingMore: document.nextOffset !== undefined && document.nextOffset !== null,
        }
      : state,
  ),
  on(loadAgentGraphDocumentFailure, (state, { key, error }) =>
    state.documentKey === key
      ? { ...state, documentLoading: false, documentLoadingMore: false, documentError: error }
      : state,
  ),
  on(expandAgentGraphNeighbors, (state) => ({ ...state, neighborsLoading: true })),
  on(expandAgentGraphNeighborsSuccess, (state, { key, document }) =>
    state.documentKey === key && state.document
      ? { ...state, neighborsLoading: false, document: mergeAgentGraphDocuments(state.document, document) }
      : { ...state, neighborsLoading: false },
  ),
  on(expandAgentGraphNeighborsFailure, (state, { error }) => ({ ...state, neighborsLoading: false, error })),
  on(loadAgentGraphStatus, (state, { clientId, agentId }) => {
    const key = agentGraphEnvironmentKey(clientId, agentId);

    return { ...state, statusKey: key, status: state.statusKey === key ? state.status : null, statusLoading: true };
  }),
  on(loadAgentGraphStatusSuccess, (state, { clientId, agentId, status }) =>
    state.statusKey === agentGraphEnvironmentKey(clientId, agentId)
      ? { ...state, status, statusLoading: false }
      : state,
  ),
  on(loadAgentGraphStatusFailure, (state, { clientId, agentId, error }) =>
    state.statusKey === agentGraphEnvironmentKey(clientId, agentId) ? { ...state, statusLoading: false, error } : state,
  ),
  on(loadAgentGraphOverview, (state, { clientId, agentId }) => {
    const key = agentGraphEnvironmentKey(clientId, agentId);

    return {
      ...state,
      overviewKey: key,
      overview: state.overviewKey === key ? state.overview : null,
      overviewLoading: true,
    };
  }),
  on(loadAgentGraphOverviewSuccess, (state, { clientId, agentId, overview }) =>
    state.overviewKey === agentGraphEnvironmentKey(clientId, agentId)
      ? {
          ...state,
          overview,
          overviewLoading: false,
          // The overview carries the current status as well.
          status: state.statusKey === state.overviewKey ? overview.status : state.status,
        }
      : state,
  ),
  on(loadAgentGraphOverviewFailure, (state, { clientId, agentId, error }) =>
    state.overviewKey === agentGraphEnvironmentKey(clientId, agentId)
      ? { ...state, overviewLoading: false, error }
      : state,
  ),
  on(refreshAgentGraph, (state, { clientId, agentId }) => ({
    ...state,
    refreshingKey: agentGraphEnvironmentKey(clientId, agentId),
    error: null,
  })),
  on(refreshAgentGraphSuccess, (state, { clientId, agentId, response }) =>
    state.statusKey === agentGraphEnvironmentKey(clientId, agentId) && state.status
      ? { ...state, status: { ...state.status, status: response.status } }
      : state,
  ),
  on(refreshAgentGraphFailure, (state, { clientId, agentId, error }) => ({
    ...state,
    refreshingKey: state.refreshingKey === agentGraphEnvironmentKey(clientId, agentId) ? null : state.refreshingKey,
    error,
  })),
  on(agentGraphRefreshPollFinished, (state, { clientId, agentId }) => ({
    ...state,
    refreshingKey: state.refreshingKey === agentGraphEnvironmentKey(clientId, agentId) ? null : state.refreshingKey,
  })),
  on(loadAgentGraphNodeDetail, (state, { clientId, agentId, layer, nodeId }) => ({
    ...state,
    nodeDetailKey: agentGraphNodeDetailKey(clientId, agentId, layer, nodeId),
    nodeDetailLoading: true,
    nodeDetailError: null,
  })),
  on(loadAgentGraphNodeDetailSuccess, (state, { key, clientId, agentId, layer, detail }) =>
    state.nodeDetailKey === key
      ? {
          ...state,
          nodeDetailLoading: false,
          nodeDetail: { key, clientId, environmentId: agentId, layer, nodeId: detail.node.id, detail },
        }
      : state,
  ),
  on(loadAgentGraphNodeDetailFailure, (state, { key, error }) =>
    state.nodeDetailKey === key ? { ...state, nodeDetailLoading: false, nodeDetailError: error } : state,
  ),
  on(clearAgentGraphNodeDetail, (state) => ({
    ...state,
    nodeDetailKey: null,
    nodeDetail: null,
    nodeDetailLoading: false,
    nodeDetailError: null,
  })),
  on(searchAgentGraph, (state) => ({ ...state, searchLoading: true })),
  on(searchAgentGraphSuccess, (state, { response }) => ({ ...state, search: response, searchLoading: false })),
  on(searchAgentGraphFailure, (state, { error }) => ({ ...state, searchLoading: false, error })),
  on(clearAgentGraphSearch, (state) => ({ ...state, search: null, searchLoading: false })),
  on(loadAgentGraphReferences, (state, { clientId, agentId }) => {
    const key = agentGraphEnvironmentKey(clientId, agentId);

    return {
      ...state,
      referencesKey: key,
      references: state.referencesKey === key ? state.references : null,
      referencesLoading: true,
    };
  }),
  on(loadAgentGraphReferencesSuccess, (state, { clientId, agentId, response }) =>
    state.referencesKey === agentGraphEnvironmentKey(clientId, agentId)
      ? { ...state, references: response, referencesLoading: false }
      : state,
  ),
  on(loadAgentGraphReferencesFailure, (state, { clientId, agentId, error }) =>
    state.referencesKey === agentGraphEnvironmentKey(clientId, agentId)
      ? { ...state, referencesLoading: false, error }
      : state,
  ),
  on(refreshWorkspaceGraphSnapshot, (state) => ({ ...state, snapshotRefreshing: true, error: null })),
  on(refreshWorkspaceGraphSnapshotSuccess, (state, { status }) => ({
    ...state,
    snapshotRefreshing: false,
    snapshotStatus: status,
  })),
  on(refreshWorkspaceGraphSnapshotFailure, (state, { error }) => ({ ...state, snapshotRefreshing: false, error })),
  on(loadGlobalAgentGraphStatus, (state) => ({ ...state, globalStatusLoading: true })),
  on(loadGlobalAgentGraphStatusSuccess, (state, { statuses }) => ({
    ...state,
    globalStatuses: statuses,
    globalStatusLoading: false,
  })),
  on(loadGlobalAgentGraphStatusFailure, (state, { error }) => ({ ...state, globalStatusLoading: false, error })),
  on(clearAgentGraphsError, (state) => ({ ...state, error: null, documentError: null, nodeDetailError: null })),
);
