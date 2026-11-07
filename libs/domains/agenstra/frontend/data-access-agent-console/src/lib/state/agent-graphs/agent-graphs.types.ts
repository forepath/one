import type {
  AgentGraphBuildStatus,
  AgentGraphDocument,
  AgentGraphEdge,
  AgentGraphEdgeType,
  AgentGraphFileResponse,
  AgentGraphLayer,
  AgentGraphNode,
  AgentGraphNodeDetail,
  AgentGraphNodeType,
  AgentGraphOverview,
  AgentGraphPathResponse,
  AgentGraphPromptDetail,
  AgentGraphPromptReference,
  AgentGraphPromptSummary,
  AgentGraphQueryLayer,
  AgentGraphReferenceKind,
  AgentGraphReferencesResponse,
  AgentGraphRefreshResponse,
  AgentGraphScope,
  AgentGraphSearchHit,
  AgentGraphSearchResponse,
  AgentGraphStatus,
  AgentGraphViewLayer,
  AgentGraphWorkspaceSnapshotStatus,
} from '@forepath/agenstra/shared/util-opencode-config';

export type {
  AgentGraphBuildStatus,
  AgentGraphDocument,
  AgentGraphEdge,
  AgentGraphEdgeType,
  AgentGraphFileResponse,
  AgentGraphLayer,
  AgentGraphNode,
  AgentGraphNodeDetail,
  AgentGraphNodeType,
  AgentGraphOverview,
  AgentGraphPathResponse,
  AgentGraphPromptDetail,
  AgentGraphPromptReference,
  AgentGraphPromptSummary,
  AgentGraphQueryLayer,
  AgentGraphReferenceKind,
  AgentGraphReferencesResponse,
  AgentGraphRefreshResponse,
  AgentGraphScope,
  AgentGraphSearchHit,
  AgentGraphSearchResponse,
  AgentGraphStatus,
  AgentGraphViewLayer,
  AgentGraphWorkspaceSnapshotStatus,
};

/** Layer of a requested document (environment scope: no `knowledge`). */
export type AgentGraphDocumentLayer = AgentGraphViewLayer;

/** Nodes per page when a whole graph is loaded ("All" node limit). */
export const AGENT_GRAPH_PAGE_SIZE = 2_000;

/** What the console currently shows (one document at a time is kept in the store). */
export interface AgentGraphDocumentRequest {
  scope: AgentGraphScope;
  clientId: string | null;
  agentId?: string | null;
  layer: AgentGraphDocumentLayer;
  /** Node limit; omitted: every node, loaded page by page. */
  limit?: number;
}

/** Store key of a document (`${scope}:${clientId}:${agentId}:${layer}:${limit|all}`). */
export function agentGraphDocumentKey(request: AgentGraphDocumentRequest): string {
  return `${request.scope}:${request.clientId ?? ''}:${request.agentId ?? ''}:${request.layer}:${request.limit ?? 'all'}`;
}

/** Store key of a per-environment value (status, overview, references). */
export function agentGraphEnvironmentKey(clientId: string, agentId: string): string {
  return `${clientId}:${agentId}`;
}

/** Node detail as last loaded (one at a time). */
export interface AgentGraphNodeDetailEntry {
  /** `${clientId}:${agentId}:${layer}:${nodeId}` */
  key: string;
  clientId: string;
  environmentId: string;
  layer: AgentGraphQueryLayer;
  nodeId: string;
  detail: AgentGraphNodeDetail;
}

export function agentGraphNodeDetailKey(
  clientId: string,
  agentId: string,
  layer: AgentGraphQueryLayer,
  nodeId: string,
) {
  return `${clientId}:${agentId}:${layer}:${nodeId}`;
}

/**
 * Merges a neighborhood slice into a document: nodes / edges are de-duplicated (base wins for nodes, edges are keyed by
 * `from|type|to`). Totals never drop below the merged size.
 */
export function mergeAgentGraphDocuments(base: AgentGraphDocument, extra: AgentGraphDocument): AgentGraphDocument {
  const nodeIds = new Set(base.nodes.map((node) => node.id));
  const nodes = [...base.nodes];

  for (const node of extra.nodes) {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  }

  const edgeKey = (edge: AgentGraphEdge) => `${edge.from}|${edge.type}|${edge.to}`;
  const edgeKeys = new Set(base.edges.map(edgeKey));
  const edges = [...base.edges];

  for (const edge of extra.edges) {
    const key = edgeKey(edge);

    if (!edgeKeys.has(key) && nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
      edgeKeys.add(key);
      edges.push(edge);
    }
  }

  if (nodes.length === base.nodes.length && edges.length === base.edges.length) {
    return base;
  }

  return {
    ...base,
    nodes,
    edges,
    totalNodes: Math.max(base.totalNodes, nodes.length),
    totalEdges: Math.max(base.totalEdges, edges.length),
  };
}

/** Appends the next page of a paginated document (page metadata of the newest page wins). */
export function appendAgentGraphPage(base: AgentGraphDocument, page: AgentGraphDocument): AgentGraphDocument {
  const merged = mergeAgentGraphDocuments(base, page);

  return {
    ...merged,
    truncated: page.truncated,
    nextOffset: page.nextOffset ?? null,
    totalNodes: Math.max(page.totalNodes, merged.nodes.length),
    totalEdges: Math.max(page.totalEdges, merged.edges.length),
  };
}
