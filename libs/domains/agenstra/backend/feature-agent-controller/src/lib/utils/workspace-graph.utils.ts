import { createHash } from 'node:crypto';

import {
  AGENT_GRAPH_LIMITS,
  isAgentGraphQueryLayer,
  isAgentGraphViewLayer,
  isAgentGraphNodeType,
  isValidAgentGraphNodeId,
  parseScopedAgentGraphNodeId,
  type AgentGraphAttrValue,
  type AgentGraphBuildStatus,
  type AgentGraphDocument,
  type AgentGraphEdge,
  type AgentGraphEnvironmentDigest,
  type AgentGraphQueryLayer,
  type AgentGraphViewLayer,
  type AgentGraphNode,
  type AgentGraphNodeType,
  type AgentGraphNodeDetail,
  type AgentGraphPathResponse,
  type AgentGraphReferencesResponse,
  type AgentGraphSearchResponse,
} from '@forepath/agenstra/shared/util-opencode-config';
import { getMissingPatScopes, type UserInfoFromRequest } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException } from '@nestjs/common';

/** Bounds of the controller's per-workspace metadata snapshot (global graph). */
export const WORKSPACE_GRAPH_LIMITS = {
  maxTickets: 2_000,
  maxKnowledgeNodes: 2_000,
  maxPlans: 500,
  maxKnowledgeRelations: 10_000,
  /** Modules taken from each environment digest (largest first). */
  maxModulesPerEnvironment: 12,
  /** Snapshots older than this are rebuilt lazily. */
  staleAfterMs: 15 * 60_000,
  /** Environment digests fetched in parallel per workspace build. */
  digestConcurrency: 4,
  /** Workspace snapshots built in parallel (background refreshes of the global graph). */
  buildConcurrency: 2,
  /** Plan labels are cut to this length (summaries only, never plan bodies). */
  planLabelMaxLength: 160,
  errorMaxLength: 1_000,
} as const;

/** Node type → PAT scope a machine caller needs to see the node in a snapshot / global graph. */
const NODE_TYPE_REQUIRED_SCOPE: Partial<Record<AgentGraphNodeType, string>> = {
  ticket: 'tickets:read',
  knowledge: 'knowledge:read',
  'knowledge-folder': 'knowledge:read',
  plan: 'agent_chats:read',
  // Chat attachments and prompt / session nodes mirror chats.
  attachment: 'agent_chats:read',
  prompt: 'agent_chats:read',
  session: 'agent_chats:read',
  module: 'agent_files:read',
  language: 'agent_files:read',
};

export interface WorkspaceGraphEnvironmentInput {
  agentId: string;
  name?: string;
  /** Manager key of the workspace endpoint (see {@link computeManagerKey}). */
  managerKey: string;
  digest?: AgentGraphEnvironmentDigest;
  /** Status used when the digest could not be fetched. */
  failedStatus?: AgentGraphBuildStatus;
}

export interface WorkspaceGraphKnowledgeInput {
  id: string;
  nodeType: 'folder' | 'page' | string;
  parentId?: string | null;
  title: string;
  longSha?: string | null;
}

export interface WorkspaceGraphTicketInput {
  id: string;
  parentId?: string | null;
  title: string;
  longSha?: string | null;
  status: string;
  priority: string;
}

export interface WorkspaceGraphPlanInput {
  id: string;
  agentId: string;
  summary?: string | null;
  longSha?: string | null;
  status: string;
}

export interface WorkspaceGraphRelationInput {
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetNodeId?: string | null;
  targetTicketLongSha?: string | null;
}

export interface WorkspaceGraphInput {
  clientId: string;
  clientName?: string;
  environments: WorkspaceGraphEnvironmentInput[];
  knowledge: WorkspaceGraphKnowledgeInput[];
  tickets: WorkspaceGraphTicketInput[];
  plans: WorkspaceGraphPlanInput[];
  relations: WorkspaceGraphRelationInput[];
}

/** Stable, non-reversible key of an agent-manager endpoint (environments of one manager share mounts). */
export function computeManagerKey(endpoint: string): string {
  const normalized = endpoint.trim().replace(/\/+$/, '').toLowerCase();

  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export const workspaceGraphNodeId = (clientId: string): string => `workspace:${clientId}`;
export const environmentGraphNodeId = (agentId: string): string => `environment:${agentId}`;
export const knowledgeGraphNodeId = (nodeId: string): string => `knowledge:${nodeId}`;
export const ticketGraphNodeId = (ticketId: string): string => `ticket:${ticketId}`;
export const planGraphNodeId = (planId: string): string => `plan:${planId}`;
export const languageGraphNodeId = (name: string): string => `language:${name}`;
export const moduleGraphNodeId = (agentId: string, moduleId: string): string => `module:${agentId}:${moduleId}`;

function edgeKey(edge: AgentGraphEdge): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.type}`;
}

/** Mutable node / edge collection with id / edge de-duplication. */
class GraphCollector {
  readonly nodes = new Map<string, AgentGraphNode>();
  readonly edges = new Map<string, AgentGraphEdge>();

  addNode(node: AgentGraphNode): void {
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, node);
    }
  }

  addEdge(edge: AgentGraphEdge): void {
    if (edge.from === edge.to || !this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      return;
    }

    const key = edgeKey(edge);

    if (!this.edges.has(key)) {
      this.edges.set(key, edge);
    }
  }
}

function buildEnvironmentNodes(
  collector: GraphCollector,
  workspaceId: string,
  env: WorkspaceGraphEnvironmentInput,
): void {
  const envId = environmentGraphNodeId(env.agentId);
  const digest = env.digest;
  const attrs: Record<string, AgentGraphAttrValue> = {
    status: digest?.status.status ?? env.failedStatus ?? 'missing',
    fileCount: digest?.status.fileCount ?? 0,
    builtAt: digest?.status.builtAt ?? null,
    managerKey: env.managerKey,
    referencedMountIds: [...new Set(digest?.referencedMountIds ?? [])],
  };

  if (digest?.mountId) {
    attrs['mountId'] = digest.mountId;
  }

  collector.addNode({ id: envId, type: 'environment', label: env.name?.trim() || env.agentId, attrs });
  collector.addEdge({ from: workspaceId, to: envId, type: 'contains', confidence: 'extracted' });

  if (!digest) {
    return;
  }

  const modules = [...digest.modules]
    .sort((a, b) => b.files - a.files)
    .slice(0, WORKSPACE_GRAPH_LIMITS.maxModulesPerEnvironment);

  for (const entry of modules) {
    const moduleId = moduleGraphNodeId(env.agentId, entry.id);

    collector.addNode({
      id: moduleId,
      type: 'module',
      label: entry.label,
      ...(entry.path ? { path: entry.path } : {}),
      attrs: { files: entry.files, environmentId: env.agentId },
    });
    collector.addEdge({ from: envId, to: moduleId, type: 'contains', confidence: 'extracted' });
  }

  for (const [language, files] of Object.entries(digest.status.languages ?? {})) {
    if (!language || files <= 0) {
      continue;
    }

    const languageId = languageGraphNodeId(language);

    collector.addNode({ id: languageId, type: 'language', label: language });
    collector.addEdge({ from: envId, to: languageId, type: 'written_in', confidence: 'extracted', attrs: { files } });
  }
}

/**
 * Environment → environment `references` edges: an environment references another one when its digest lists the
 * other's mount id and both run on the same agent-manager (`managerKey`). Returns only edges not present yet.
 */
export function buildCrossEnvironmentReferenceEdges(
  nodes: readonly AgentGraphNode[],
  existingEdges: readonly AgentGraphEdge[] = [],
): AgentGraphEdge[] {
  const byMount = new Map<string, string[]>();

  for (const node of nodes) {
    const mountId = node.type === 'environment' ? node.attrs?.['mountId'] : undefined;
    const managerKey = node.attrs?.['managerKey'];

    if (typeof mountId === 'string' && typeof managerKey === 'string') {
      const key = `${managerKey}|${mountId}`;

      byMount.set(key, [...(byMount.get(key) ?? []), node.id]);
    }
  }

  const seen = new Set(existingEdges.map(edgeKey));
  const result: AgentGraphEdge[] = [];

  for (const node of nodes) {
    if (node.type !== 'environment') {
      continue;
    }

    const managerKey = node.attrs?.['managerKey'];
    const referenced = node.attrs?.['referencedMountIds'];

    if (typeof managerKey !== 'string' || !Array.isArray(referenced)) {
      continue;
    }

    for (const mountId of referenced) {
      for (const target of byMount.get(`${managerKey}|${mountId}`) ?? []) {
        const edge: AgentGraphEdge = {
          from: node.id,
          to: target,
          type: 'references',
          confidence: 'inferred',
          attrs: { mountId },
        };
        const key = edgeKey(edge);

        if (target !== node.id && !seen.has(key)) {
          seen.add(key);
          result.push(edge);
        }
      }
    }
  }

  return result;
}

/**
 * Metadata graph of one workspace: environments (digest summaries), knowledge, tickets and plans with their
 * hierarchy and relations. Titles and ids only, never ticket / page / plan bodies.
 */
export function buildWorkspaceSnapshotGraph(input: WorkspaceGraphInput, now = new Date()): AgentGraphDocument {
  const collector = new GraphCollector();
  const workspaceId = workspaceGraphNodeId(input.clientId);

  collector.addNode({
    id: workspaceId,
    type: 'workspace',
    label: input.clientName?.trim() || input.clientId,
    attrs: { clientId: input.clientId },
  });

  for (const env of input.environments) {
    buildEnvironmentNodes(collector, workspaceId, env);
  }

  // Knowledge tree (folders and pages).
  const knowledge = input.knowledge.slice(0, WORKSPACE_GRAPH_LIMITS.maxKnowledgeNodes);

  for (const item of knowledge) {
    collector.addNode({
      id: knowledgeGraphNodeId(item.id),
      type: item.nodeType === 'folder' ? 'knowledge-folder' : 'knowledge',
      label: item.title,
      attrs: { sha: item.longSha ?? null },
    });
  }

  for (const item of knowledge) {
    const parent = item.parentId ? knowledgeGraphNodeId(item.parentId) : undefined;
    const from = parent && collector.nodes.has(parent) ? parent : workspaceId;

    collector.addEdge({ from, to: knowledgeGraphNodeId(item.id), type: 'contains', confidence: 'extracted' });
  }

  // Tickets (with sub-tickets).
  const tickets = input.tickets.slice(0, WORKSPACE_GRAPH_LIMITS.maxTickets);
  const ticketIdBySha = new Map<string, string>();

  for (const ticket of tickets) {
    collector.addNode({
      id: ticketGraphNodeId(ticket.id),
      type: 'ticket',
      label: ticket.title,
      attrs: { sha: ticket.longSha ?? null, status: ticket.status, priority: ticket.priority },
    });

    if (ticket.longSha) {
      ticketIdBySha.set(ticket.longSha, ticket.id);
    }
  }

  for (const ticket of tickets) {
    const parent = ticket.parentId ? ticketGraphNodeId(ticket.parentId) : undefined;
    const from = parent && collector.nodes.has(parent) ? parent : workspaceId;

    collector.addEdge({ from, to: ticketGraphNodeId(ticket.id), type: 'contains', confidence: 'extracted' });
  }

  // Plans of the workspace's environments.
  for (const plan of input.plans.slice(0, WORKSPACE_GRAPH_LIMITS.maxPlans)) {
    const envId = environmentGraphNodeId(plan.agentId);

    if (!collector.nodes.has(envId)) {
      continue;
    }

    const summary = plan.summary?.trim();
    const label = summary
      ? summary.slice(0, WORKSPACE_GRAPH_LIMITS.planLabelMaxLength)
      : `Plan ${(plan.longSha ?? plan.id).slice(0, 8)}`;

    collector.addNode({
      id: planGraphNodeId(plan.id),
      type: 'plan',
      label,
      attrs: { sha: plan.longSha ?? null, agentId: plan.agentId, status: plan.status },
    });
    collector.addEdge({ from: envId, to: planGraphNodeId(plan.id), type: 'contains', confidence: 'extracted' });
  }

  // Knowledge relations (ticket / page → ticket / folder / page).
  for (const relation of input.relations.slice(0, WORKSPACE_GRAPH_LIMITS.maxKnowledgeRelations)) {
    const from =
      relation.sourceType === 'ticket' ? ticketGraphNodeId(relation.sourceId) : knowledgeGraphNodeId(relation.sourceId);
    let to: string | undefined;

    if (relation.targetType === 'ticket') {
      const ticketId = relation.targetTicketLongSha ? ticketIdBySha.get(relation.targetTicketLongSha) : undefined;

      to = ticketId ? ticketGraphNodeId(ticketId) : undefined;
    } else if (relation.targetNodeId) {
      to = knowledgeGraphNodeId(relation.targetNodeId);
    }

    if (to) {
      collector.addEdge({ from, to, type: 'relates_to', confidence: 'extracted' });
    }
  }

  const nodes = [...collector.nodes.values()];
  const edges = [...collector.edges.values()];

  edges.push(...buildCrossEnvironmentReferenceEdges(nodes, edges));

  return {
    version: 1,
    scope: 'global',
    layer: 'global',
    clientId: input.clientId,
    generatedAt: now.toISOString(),
    nodes,
    edges,
    truncated: false,
    totalNodes: nodes.length,
    totalEdges: edges.length,
  };
}

/**
 * Union of workspace snapshots (nodes de-duplicated by id, so `language:*` nodes are shared) plus cross-workspace
 * environment references. Only pass snapshots of workspaces the caller may access.
 */
export function unionWorkspaceGraphs(
  documents: readonly AgentGraphDocument[],
): Pick<AgentGraphDocument, 'nodes' | 'edges'> {
  const nodes = new Map<string, AgentGraphNode>();
  const edges = new Map<string, AgentGraphEdge>();

  for (const document of documents) {
    for (const node of document.nodes) {
      if (!nodes.has(node.id)) {
        nodes.set(node.id, node);
      }
    }
  }

  for (const document of documents) {
    for (const edge of document.edges) {
      if (nodes.has(edge.from) && nodes.has(edge.to)) {
        edges.set(edgeKey(edge), edge);
      }
    }
  }

  const nodeList = [...nodes.values()];
  const edgeList = [...edges.values()];

  edgeList.push(...buildCrossEnvironmentReferenceEdges(nodeList, edgeList));

  return { nodes: nodeList, edges: edgeList };
}

/** Workspaces and environments always rank first; the rest by degree (highest first). */
export function limitGraphByDegree(
  nodes: readonly AgentGraphNode[],
  edges: readonly AgentGraphEdge[],
  limit: number,
): { nodes: AgentGraphNode[]; edges: AgentGraphEdge[]; truncated: boolean } {
  if (nodes.length <= limit) {
    return { nodes: [...nodes], edges: [...edges], truncated: false };
  }

  const degree = new Map<string, number>();

  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  const rank = (node: AgentGraphNode): number => (node.type === 'workspace' ? 0 : node.type === 'environment' ? 1 : 2);
  const kept = nodes
    .map((node, index) => ({ node, index }))
    .sort(
      (a, b) =>
        rank(a.node) - rank(b.node) || (degree.get(b.node.id) ?? 0) - (degree.get(a.node.id) ?? 0) || a.index - b.index,
    )
    .slice(0, Math.max(0, limit))
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.node);
  const keptIds = new Set(kept.map((node) => node.id));

  return {
    nodes: kept,
    edges: edges.filter((edge) => keptIds.has(edge.from) && keptIds.has(edge.to)),
    truncated: true,
  };
}

/** Whether a scope is granted: always for interactive sessions and the API key; PATs need it in their grant. */
export type GraphScopeCheck = (scope: string) => boolean;

export function createGraphScopeCheck(userInfo: UserInfoFromRequest): GraphScopeCheck {
  if (userInfo.isApiKeyAuth || !(userInfo.amr ?? []).includes('pat')) {
    return () => true;
  }

  const granted = userInfo.scopes ?? [];

  return (scope) => getMissingPatScopes(granted, [scope]).length === 0;
}

/** PAT scope needed to see nodes of a type in snapshot / global graphs (`undefined`: graph scope suffices). */
export function requiredScopeForGraphNodeType(type: AgentGraphNodeType): string | undefined {
  return NODE_TYPE_REQUIRED_SCOPE[type];
}

/** Whether the caller's PAT scopes cover a node of this type. */
export function isGraphNodeTypeAllowed(type: AgentGraphNodeType | string, isAllowed: GraphScopeCheck): boolean {
  const scope = requiredScopeForGraphNodeType(type as AgentGraphNodeType);

  return !scope || isAllowed(scope);
}

/**
 * Nodes and edges the caller's PAT scopes cover: drops tickets, knowledge, plans, attachments, prompts (and modules /
 * languages) the scopes do not cover plus every edge touching them. Without the chats scope, environments also lose
 * the mounts their prompts referenced and the inferred environment-to-environment `references` edges built from them.
 */
export function filterGraphPartByScopes(
  nodes: readonly AgentGraphNode[],
  edges: readonly AgentGraphEdge[],
  isAllowed: GraphScopeCheck,
): { nodes: AgentGraphNode[]; edges: AgentGraphEdge[]; removedNodes: number } {
  const allowedByType = new Map<string, boolean>();
  const chats = isAllowed('agent_chats:read');
  const kept: AgentGraphNode[] = [];
  const environments = new Set<string>();

  for (const node of nodes) {
    let allowed = allowedByType.get(node.type);

    if (allowed === undefined) {
      allowed = isGraphNodeTypeAllowed(node.type, isAllowed);
      allowedByType.set(node.type, allowed);
    }

    if (!allowed) {
      continue;
    }

    if (node.type === 'environment') {
      environments.add(node.id);

      if (!chats && node.attrs && 'referencedMountIds' in node.attrs) {
        const attrs = { ...node.attrs };

        delete attrs['referencedMountIds'];
        kept.push({ ...node, attrs });
        continue;
      }
    }

    kept.push(node);
  }

  // Edges may point at nodes of other pages: drop those touching a removed node or a node whose id names a type the
  // scopes do not cover (`ticket:…`, `env::knowledge:…`), keep the rest.
  const removed = new Set(nodes.filter((node) => !allowedByType.get(node.type)).map((node) => node.id));
  const hidden = (id: string): boolean => {
    if (removed.has(id)) {
      return true;
    }

    const raw = parseScopedAgentGraphNodeId(id)?.nodeId ?? id;
    const colon = raw.indexOf(':');

    return colon > 0 && !isGraphNodeTypeAllowed(raw.slice(0, colon), isAllowed);
  };
  const isEnvironment = (id: string): boolean =>
    environments.has(id) || (parseScopedAgentGraphNodeId(id)?.nodeId ?? id).startsWith('environment:');
  const keptEdges = edges.filter(
    (edge) =>
      !hidden(edge.from) &&
      !hidden(edge.to) &&
      (chats || !(edge.type === 'references' && isEnvironment(edge.from) && isEnvironment(edge.to))),
  );

  return { nodes: kept, edges: keptEdges, removedNodes: nodes.length - kept.length };
}

/**
 * {@link filterGraphPartByScopes} for a whole document. Totals are recomputed for unpaged documents; a page keeps its
 * paging fields and only subtracts what it removed.
 */
export function filterGraphByScopes(document: AgentGraphDocument, isAllowed: GraphScopeCheck): AgentGraphDocument {
  if (!document?.nodes) {
    return document;
  }

  const filtered = filterGraphPartByScopes(document.nodes, document.edges, isAllowed);

  if (
    filtered.removedNodes === 0 &&
    filtered.edges.length === document.edges.length &&
    filtered.nodes.every((node, index) => node === document.nodes[index])
  ) {
    return document;
  }

  const paged = document.offset !== undefined || (document.nextOffset !== undefined && document.nextOffset !== null);

  return {
    ...document,
    nodes: filtered.nodes,
    edges: filtered.edges,
    totalNodes: paged ? Math.max(0, (document.totalNodes ?? 0) - filtered.removedNodes) : filtered.nodes.length,
    totalEdges: paged
      ? Math.max(0, (document.totalEdges ?? 0) - (document.edges.length - filtered.edges.length))
      : filtered.edges.length,
  };
}

/** Node detail within the caller's scopes: a node they may not see is not found; hidden neighbors are dropped. */
export function filterNodeDetailByScopes(
  detail: AgentGraphNodeDetail,
  isAllowed: GraphScopeCheck,
): AgentGraphNodeDetail {
  if (!detail?.node) {
    return detail;
  }

  if (!isGraphNodeTypeAllowed(detail.node.type, isAllowed)) {
    throw new NotFoundException('Graph node not found');
  }

  const keep = (relation: { node: AgentGraphNode }) => isGraphNodeTypeAllowed(relation.node.type, isAllowed);
  const node = filterGraphPartByScopes([detail.node], [], isAllowed).nodes[0] ?? detail.node;

  return { ...detail, node, outgoing: detail.outgoing.filter(keep), incoming: detail.incoming.filter(keep) };
}

/** Search hits within the caller's scopes (type counts of hidden types are dropped too). */
export function filterSearchByScopes(
  result: AgentGraphSearchResponse,
  isAllowed: GraphScopeCheck,
): AgentGraphSearchResponse {
  if (!result) {
    return result;
  }

  const byType = Object.fromEntries(
    Object.entries(result.byType ?? {}).filter(([type]) => isGraphNodeTypeAllowed(type, isAllowed)),
  ) as AgentGraphSearchResponse['byType'];

  return {
    ...result,
    hits: (result.hits ?? []).filter((hit) => isGraphNodeTypeAllowed(hit.node.type, isAllowed)),
    byType,
  };
}

/** A path through a node the caller may not see is reported as not found. */
export function filterPathByScopes(result: AgentGraphPathResponse, isAllowed: GraphScopeCheck): AgentGraphPathResponse {
  if (!result?.nodes) {
    return result;
  }

  if (result.nodes.every((node) => isGraphNodeTypeAllowed(node.type, isAllowed))) {
    return { ...result, nodes: filterGraphPartByScopes(result.nodes, [], isAllowed).nodes };
  }

  return { ...result, found: false, nodes: [], edges: [] };
}

/** Prompt references within the caller's scopes (e.g. no ticket titles without `tickets:read`). */
export function filterPromptReferencesByScopes(
  response: AgentGraphReferencesResponse,
  isAllowed: GraphScopeCheck,
): AgentGraphReferencesResponse {
  if (!response?.prompt?.references) {
    return response;
  }

  return {
    ...response,
    prompt: {
      ...response.prompt,
      references: response.prompt.references.filter((reference) => isGraphNodeTypeAllowed(reference.type, isAllowed)),
    },
  };
}

/** An empty graph document (no snapshot yet). */
export function emptyGlobalGraphDocument(clientId?: string, now = new Date()): AgentGraphDocument {
  return {
    version: 1,
    scope: 'global',
    layer: 'global',
    ...(clientId ? { clientId } : {}),
    generatedAt: now.toISOString(),
    nodes: [],
    edges: [],
    truncated: false,
    totalNodes: 0,
    totalEdges: 0,
  };
}

// --- Query parameter whitelisting (controller → manager) ---------------------------------------------------------

/** Integer within [min, max]; `undefined` for missing / non-numeric input. */
export function clampGraphInt(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/** Optional manager graph layer (`all`, `code`, `paths`, `references`); rejects unknown layers. */
export function parseGraphLayer(value: unknown): AgentGraphQueryLayer | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (!isAgentGraphQueryLayer(value)) {
    throw new BadRequestException('Invalid graph layer');
  }

  return value;
}

/** View layer of workspace / global graphs (`all` by default, `knowledge` = the persisted metadata snapshots). */
export function parseGraphViewLayer(value: unknown): AgentGraphViewLayer {
  if (value === undefined || value === null || value === '') {
    return 'all';
  }

  if (!isAgentGraphViewLayer(value)) {
    throw new BadRequestException('Invalid graph layer');
  }

  return value;
}

/** PAT scopes a layer needs besides `graph:read` (the `knowledge` layer is filtered node by node instead). */
export function requiredScopesForGraphLayer(layer: AgentGraphViewLayer): string[] {
  switch (layer) {
    case 'code':
    case 'paths':
      return ['agent_files:read'];
    case 'references':
    case 'all':
      return ['agent_files:read', 'agent_chats:read'];
    default:
      return [];
  }
}

/** Comma list of node types; unknown types are dropped. */
export function parseGraphNodeTypes(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }

  const types = [
    ...new Set(
      value
        .slice(0, AGENT_GRAPH_LIMITS.queryMaxLength)
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => isAgentGraphNodeType(entry)),
    ),
  ];

  return types.length > 0 ? types.join(',') : undefined;
}

/** Free-text search query, trimmed and capped. */
export function parseGraphQuery(value: unknown): string {
  const query = typeof value === 'string' ? value.trim().slice(0, AGENT_GRAPH_LIMITS.queryMaxLength) : '';

  if (!query) {
    throw new BadRequestException('query is required');
  }

  return query;
}

/** Required node id / path parameter (bounded, printable). */
export function parseGraphId(value: unknown, name: string): string {
  if (!isValidAgentGraphNodeId(value)) {
    throw new BadRequestException(`${name} is required (at most ${AGENT_GRAPH_LIMITS.idMaxLength} characters)`);
  }

  return value;
}

/** Optional node id parameter. */
export function parseOptionalGraphId(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return parseGraphId(value, name);
}

/** Truncate a stored error message. */
export function truncateGraphError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');

  return message.slice(0, WORKSPACE_GRAPH_LIMITS.errorMaxLength);
}

/**
 * `Promise.allSettled` over `items` with at most `concurrency` calls in flight; results keep the input order.
 */
export async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;

      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker()));

  return results;
}

/**
 * Finish a manager-composed workspace graph: keep only nodes of the controller-verified member environments, add the
 * `workspace:<clientId>` node with `contains` edges to every environment node and set `clientId`.
 */
export function attachWorkspaceToComposedGraph(
  document: AgentGraphDocument,
  clientId: string,
  memberAgentIds: readonly string[],
  clientName?: string,
): AgentGraphDocument {
  const members = new Set(memberAgentIds.map((id) => id.toLowerCase()));
  const belongs = (node: AgentGraphNode): boolean => {
    if (node.type === 'environment' && node.id.startsWith('environment:')) {
      return members.has(node.id.slice('environment:'.length).toLowerCase());
    }

    const scoped = parseScopedAgentGraphNodeId(node.id);

    // Unscoped shared nodes (e.g. `language:*`) are kept; scoped nodes only for member environments.
    return !scoped || members.has(scoped.environmentId.toLowerCase());
  };
  const workspaceId = workspaceGraphNodeId(clientId);
  const nodes = document.nodes.filter(belongs);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = document.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  const environmentIds = nodes.filter((node) => node.type === 'environment').map((node) => node.id);

  nodes.unshift({ id: workspaceId, type: 'workspace', label: clientName?.trim() || clientId, attrs: { clientId } });

  for (const environmentId of environmentIds) {
    edges.push({ from: workspaceId, to: environmentId, type: 'contains', confidence: 'extracted' });
  }

  const droppedNodes = document.nodes.length - (nodes.length - 1);
  const droppedEdges = document.edges.length - (edges.length - environmentIds.length);

  return {
    ...document,
    scope: 'workspace',
    clientId,
    nodes,
    edges,
    totalNodes: Math.max(nodes.length, document.totalNodes - droppedNodes + 1),
    totalEdges: Math.max(edges.length, document.totalEdges - droppedEdges + environmentIds.length),
  };
}
