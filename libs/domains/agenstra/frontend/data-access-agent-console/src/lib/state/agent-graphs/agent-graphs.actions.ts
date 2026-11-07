import { createAction, props } from '@ngrx/store';

import type {
  AgentGraphDocument,
  AgentGraphQueryLayer,
  AgentGraphNodeDetail,
  AgentGraphNodeType,
  AgentGraphOverview,
  AgentGraphReferencesResponse,
  AgentGraphRefreshResponse,
  AgentGraphSearchResponse,
  AgentGraphStatus,
  AgentGraphViewLayer,
  AgentGraphWorkspaceSnapshotStatus,
} from './agent-graphs.types';

// Documents (one is kept: the one currently viewed). Every load action resolves to the shared success / failure.

/** Environment graph (`GET clients/:id/agents/:agentId/graph`). Without `limit` every page is loaded in turn. */
export const loadAgentGraphDocument = createAction(
  '[Agent Graphs] Load Document',
  props<{
    clientId: string;
    agentId: string;
    layer: AgentGraphQueryLayer;
    limit?: number;
    types?: AgentGraphNodeType[];
  }>(),
);

/** Workspace graph per layer (`GET clients/:id/graph`; `knowledge` = the metadata snapshot). */
export const loadWorkspaceAgentGraph = createAction(
  '[Agent Graphs] Load Workspace Graph',
  props<{ clientId: string; layer: AgentGraphViewLayer; limit?: number }>(),
);

/** Graph over every accessible workspace per layer (`GET graph/global`). */
export const loadGlobalAgentGraph = createAction(
  '[Agent Graphs] Load Global Graph',
  props<{ layer: AgentGraphViewLayer; limit?: number }>(),
);

export const loadAgentGraphDocumentSuccess = createAction(
  '[Agent Graphs] Load Document Success',
  props<{ key: string; document: AgentGraphDocument }>(),
);

/** Next page of a document loaded page by page ("All" node limit). */
export const loadAgentGraphDocumentPageSuccess = createAction(
  '[Agent Graphs] Load Document Page Success',
  props<{ key: string; document: AgentGraphDocument }>(),
);

export const loadAgentGraphDocumentFailure = createAction(
  '[Agent Graphs] Load Document Failure',
  props<{ key: string; error: string }>(),
);

/** Merges a neighborhood slice into the current environment document. */
export const expandAgentGraphNeighbors = createAction(
  '[Agent Graphs] Expand Neighbors',
  props<{
    clientId: string;
    agentId: string;
    layer: AgentGraphQueryLayer;
    nodeId: string;
    depth?: number;
    /** Node limit of the shown document (part of its store key). */
    limit?: number;
  }>(),
);

export const expandAgentGraphNeighborsSuccess = createAction(
  '[Agent Graphs] Expand Neighbors Success',
  props<{ key: string; document: AgentGraphDocument }>(),
);

export const expandAgentGraphNeighborsFailure = createAction(
  '[Agent Graphs] Expand Neighbors Failure',
  props<{ error: string }>(),
);

// Environment status / overview / refresh

export const loadAgentGraphStatus = createAction(
  '[Agent Graphs] Load Status',
  props<{ clientId: string; agentId: string }>(),
);

export const loadAgentGraphStatusSuccess = createAction(
  '[Agent Graphs] Load Status Success',
  props<{ clientId: string; agentId: string; status: AgentGraphStatus }>(),
);

export const loadAgentGraphStatusFailure = createAction(
  '[Agent Graphs] Load Status Failure',
  props<{ clientId: string; agentId: string; error: string }>(),
);

export const loadAgentGraphOverview = createAction(
  '[Agent Graphs] Load Overview',
  props<{ clientId: string; agentId: string }>(),
);

export const loadAgentGraphOverviewSuccess = createAction(
  '[Agent Graphs] Load Overview Success',
  props<{ clientId: string; agentId: string; overview: AgentGraphOverview }>(),
);

export const loadAgentGraphOverviewFailure = createAction(
  '[Agent Graphs] Load Overview Failure',
  props<{ clientId: string; agentId: string; error: string }>(),
);

/** Queues a rebuild; the status is then polled while it is `building` and the document reloaded afterwards. */
export const refreshAgentGraph = createAction(
  '[Agent Graphs] Refresh',
  props<{ clientId: string; agentId: string; layer: AgentGraphQueryLayer; limit?: number }>(),
);

export const refreshAgentGraphSuccess = createAction(
  '[Agent Graphs] Refresh Success',
  props<{
    clientId: string;
    agentId: string;
    layer: AgentGraphQueryLayer;
    limit?: number;
    response: AgentGraphRefreshResponse;
  }>(),
);

export const refreshAgentGraphFailure = createAction(
  '[Agent Graphs] Refresh Failure',
  props<{ clientId: string; agentId: string; error: string }>(),
);

/** Status polling after a refresh ended (build finished or the poll window elapsed). */
export const agentGraphRefreshPollFinished = createAction(
  '[Agent Graphs] Refresh Poll Finished',
  props<{ clientId: string; agentId: string; status: AgentGraphStatus | null }>(),
);

// Node detail / search / references

export const loadAgentGraphNodeDetail = createAction(
  '[Agent Graphs] Load Node Detail',
  props<{ clientId: string; agentId: string; layer: AgentGraphQueryLayer; nodeId: string }>(),
);

export const loadAgentGraphNodeDetailSuccess = createAction(
  '[Agent Graphs] Load Node Detail Success',
  props<{
    key: string;
    clientId: string;
    agentId: string;
    layer: AgentGraphQueryLayer;
    detail: AgentGraphNodeDetail;
  }>(),
);

export const loadAgentGraphNodeDetailFailure = createAction(
  '[Agent Graphs] Load Node Detail Failure',
  props<{ key: string; error: string }>(),
);

export const clearAgentGraphNodeDetail = createAction('[Agent Graphs] Clear Node Detail');

export const searchAgentGraph = createAction(
  '[Agent Graphs] Search',
  props<{
    clientId: string;
    agentId: string;
    query: string;
    layer?: AgentGraphQueryLayer;
    types?: AgentGraphNodeType[];
    limit?: number;
  }>(),
);

export const searchAgentGraphSuccess = createAction(
  '[Agent Graphs] Search Success',
  props<{ response: AgentGraphSearchResponse }>(),
);

export const searchAgentGraphFailure = createAction('[Agent Graphs] Search Failure', props<{ error: string }>());

export const clearAgentGraphSearch = createAction('[Agent Graphs] Clear Search');

export const loadAgentGraphReferences = createAction(
  '[Agent Graphs] Load References',
  props<{ clientId: string; agentId: string; promptId?: string; limit?: number }>(),
);

export const loadAgentGraphReferencesSuccess = createAction(
  '[Agent Graphs] Load References Success',
  props<{ clientId: string; agentId: string; response: AgentGraphReferencesResponse }>(),
);

export const loadAgentGraphReferencesFailure = createAction(
  '[Agent Graphs] Load References Failure',
  props<{ clientId: string; agentId: string; error: string }>(),
);

// Workspace snapshot / global status

/** Rebuilds the workspace snapshot, then reloads the workspace graph of `layer`. */
export const refreshWorkspaceGraphSnapshot = createAction(
  '[Agent Graphs] Refresh Workspace Snapshot',
  props<{ clientId: string; layer: AgentGraphViewLayer; limit?: number }>(),
);

export const refreshWorkspaceGraphSnapshotSuccess = createAction(
  '[Agent Graphs] Refresh Workspace Snapshot Success',
  props<{ clientId: string; status: AgentGraphWorkspaceSnapshotStatus }>(),
);

export const refreshWorkspaceGraphSnapshotFailure = createAction(
  '[Agent Graphs] Refresh Workspace Snapshot Failure',
  props<{ clientId: string; error: string }>(),
);

export const loadGlobalAgentGraphStatus = createAction('[Agent Graphs] Load Global Status');

export const loadGlobalAgentGraphStatusSuccess = createAction(
  '[Agent Graphs] Load Global Status Success',
  props<{ statuses: AgentGraphWorkspaceSnapshotStatus[] }>(),
);

export const loadGlobalAgentGraphStatusFailure = createAction(
  '[Agent Graphs] Load Global Status Failure',
  props<{ error: string }>(),
);

export const clearAgentGraphsError = createAction('[Agent Graphs] Clear Error');
