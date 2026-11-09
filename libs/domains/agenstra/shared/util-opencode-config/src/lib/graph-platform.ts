/**
 * Environment graphs: structural indexes of what an environment (agent) contains and which context its prompts saw.
 *
 * - The agent-manager builds and stores one graph set per environment (`code`, `paths`, `references` layers). Files
 *   are streamed out of the worker (read-only exec) and parsed in the manager; nothing is written into the
 *   container's file system.
 * - A workspace graph is never stored: the manager composes it on request from the member environments the
 *   controller verified (plus cross-environment edges).
 * - The agent-controller persists one metadata snapshot per workspace (environments, knowledge, tickets, plans,
 *   environment summaries); the global graph is the union over the workspaces a caller may access.
 * - Agents query graphs through the platform `agenstra` MCP server (`agenstra_graph_*` tools): their own environment
 *   and every environment whose working directory is visible below `/opt/workspace` (read-only mount). Prompt
 *   reference graphs are limited to the own environment and peers of the same workspace.
 */

/** OpenCode names MCP tools `<server>_<tool>`, so the agent sees `agenstra_graph_*`. */
export const AGENSTRA_GRAPH_MCP_TOOL_NAMES = {
  environments: 'graph_environments',
  overview: 'graph_overview',
  search: 'graph_search',
  node: 'graph_node',
  neighbors: 'graph_neighbors',
  path: 'graph_path',
  file: 'graph_file',
  references: 'graph_references',
  refresh: 'graph_refresh',
} as const;

/** OpenCode permission key covering every graph tool (read-only; allowed in plan sessions). */
export const AGENSTRA_GRAPH_MCP_TOOL_PERMISSION = 'agenstra_graph_*';

/** Manager route segment below the agent context API route (`/api/agent-context/graphs`). */
export const AGENSTRA_GRAPH_API_SEGMENT = 'graphs';

/** Graph layers stored per environment. */
export const AGENT_GRAPH_LAYERS = ['code', 'paths', 'references'] as const;
export type AgentGraphLayer = (typeof AGENT_GRAPH_LAYERS)[number];

/**
 * Layers a view can request. `all` merges every layer available in the scope (node ids are shared across layers, so a
 * file appears once and links its imports, its directory and the prompts that touched it). `knowledge` is the
 * controller's metadata layer (workspaces, environments, knowledge pages, tickets, plans; workspace / global scope).
 */
export const AGENT_GRAPH_VIEW_LAYERS = ['all', 'code', 'paths', 'references', 'knowledge'] as const;
export type AgentGraphViewLayer = (typeof AGENT_GRAPH_VIEW_LAYERS)[number];

/** Layers the agent-manager serves (`knowledge` lives in the controller). */
export type AgentGraphQueryLayer = AgentGraphLayer | 'all';

/** Scopes of a graph view (environment: manager, workspace: composed by the manager, global: controller). */
export type AgentGraphScope = 'environment' | 'workspace' | 'global';

export const AGENT_GRAPH_NODE_TYPES = [
  // code / knowledge layer
  'environment',
  'module',
  'file',
  'symbol',
  'package',
  'doc',
  'concept',
  'instruction',
  'language',
  // paths layer
  'directory',
  'mount',
  // references layer
  'prompt',
  'session',
  'ticket',
  'knowledge',
  'plan',
  'attachment',
  'skill',
  'mcp-server',
  'command',
  'agent-profile',
  'plugin',
  'tool',
  // global layer (controller)
  /** Root of the global graph: every accessible workspace hangs below it. */
  'instance',
  'workspace',
  'knowledge-folder',
  /** Scheduled agent task of an environment. */
  'task',
  /** Initiative (planning that follows the BMad Method); also a context ref kind (`initiative:<sha>`). */
  'initiative',
  /** Document of an initiative (PRD, architecture, epic requirements, …); context ref kind `artifact:<sha>`. */
  'artifact',
  /** Epic, story, spike or bug of an initiative. */
  'work-item',
] as const;
export type AgentGraphNodeType = (typeof AGENT_GRAPH_NODE_TYPES)[number];

export const AGENT_GRAPH_EDGE_TYPES = [
  'contains',
  'imports',
  'depends_on',
  'defines',
  'links_to',
  'documents',
  'written_in',
  'mounted_at',
  /** Explicitly attached to a prompt (context injection). */
  'attached',
  /** Implicitly available to a prompt (instructions, skills, MCP servers, workspace mounts, ...). */
  'available',
  /** Actually read / searched by the turn (tool calls). */
  'used',
  /** Changed by the turn (edit / write / patch tools, content changes). */
  'modified',
  'relates_to',
  'member_of',
  'references',
] as const;
export type AgentGraphEdgeType = (typeof AGENT_GRAPH_EDGE_TYPES)[number];

/**
 * `extracted`: read from explicit structure (import statements, manifests, links, recorded events).
 * `inferred`: heuristic (name mentions, resolved-by-guess imports).
 */
export type AgentGraphConfidence = 'extracted' | 'inferred';

export type AgentGraphAttrValue = string | number | boolean | null | string[];

export interface AgentGraphNode {
  /** Stable id, unique within one environment graph (`file:src/a.ts`, `symbol:src/a.ts#Foo`, ...). */
  id: string;
  type: AgentGraphNodeType;
  label: string;
  /** Path relative to the environment's working directory (code / paths layers). */
  path?: string;
  /** Community (cluster) index assigned by label propagation; stable per build. */
  community?: number;
  attrs?: Record<string, AgentGraphAttrValue>;
}

export interface AgentGraphEdge {
  from: string;
  to: string;
  type: AgentGraphEdgeType;
  confidence?: AgentGraphConfidence;
  attrs?: Record<string, AgentGraphAttrValue>;
}

export type AgentGraphBuildStatus = 'missing' | 'building' | 'ready' | 'stale' | 'failed';

export interface AgentGraphLayerStats {
  nodes: number;
  edges: number;
  nodesByType: Partial<Record<AgentGraphNodeType, number>>;
}

/** Per-environment graph status (one row per environment in the manager). */
export interface AgentGraphStatus {
  environmentId: string;
  status: AgentGraphBuildStatus;
  builtAt: string | null;
  /** Wall time of the last build. */
  buildDurationMs: number | null;
  /** Set when files / nodes were dropped because a limit was hit. */
  truncated: boolean;
  error: string | null;
  layers: Partial<Record<AgentGraphLayer, AgentGraphLayerStats>>;
  /** File counts per detected language (code layer). */
  languages: Record<string, number>;
  fileCount: number;
}

/** Highly connected node (hub / "god node"). */
export interface AgentGraphHub {
  id: string;
  type: AgentGraphNodeType;
  label: string;
  path?: string;
  degree: number;
}

export interface AgentGraphCommunitySummary {
  id: number;
  size: number;
  /** Label of the most connected node of the community. */
  label: string;
  /** Most common directory of the community's files. */
  directory?: string;
}

export interface AgentGraphOverview {
  scope: AgentGraphScope;
  environmentId?: string;
  status: AgentGraphStatus;
  /** Working directory inside the environment (`/app`). */
  workingDirectory?: string;
  /** Where the environment's files are visible to other environments (`/opt/workspace/<mount id>`). */
  mountPath?: string;
  modules: { id: string; label: string; path?: string; files: number }[];
  hubs: AgentGraphHub[];
  communities: AgentGraphCommunitySummary[];
  /** Instruction / rule files found in the working directory (AGENTS.md, rules, skills, ...). */
  instructions: { id: string; label: string; path?: string }[];
  /** Latest prompts with reference counts (references layer; omitted when not permitted). */
  recentPrompts?: AgentGraphPromptSummary[];
}

/** A graph (or a bounded slice of one) as served to the console and the MCP tools. */
export interface AgentGraphDocument {
  version: 1;
  scope: AgentGraphScope;
  /** `global` is the legacy name of the `knowledge` layer. */
  layer: AgentGraphViewLayer | 'global';
  environmentId?: string;
  clientId?: string;
  generatedAt: string;
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
  /** True when more nodes exist than this document holds (see `nextOffset`). */
  truncated: boolean;
  totalNodes: number;
  totalEdges: number;
  /** Rank of the first node of this page (documents are paginated by `offset` / `limit`). */
  offset?: number;
  /** Offset of the next page, `null` when this is the last page. */
  nextOffset?: number | null;
}

export interface AgentGraphNodeDetail {
  node: AgentGraphNode;
  outgoing: { edge: AgentGraphEdge; node: AgentGraphNode }[];
  incoming: { edge: AgentGraphEdge; node: AgentGraphNode }[];
  /** True when the relation lists were capped. */
  truncated: boolean;
  /** Absolute path inside the calling environment (own `/app/...` or `/opt/workspace/<mount>/...`). */
  absolutePath?: string;
}

export interface AgentGraphSearchHit {
  environmentId: string;
  node: AgentGraphNode;
  score: number;
  absolutePath?: string;
}

export interface AgentGraphSearchResponse {
  query: string;
  hits: AgentGraphSearchHit[];
  byType: Partial<Record<AgentGraphNodeType, number>>;
}

export interface AgentGraphPathResponse {
  from: string;
  to: string;
  found: boolean;
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
}

export interface AgentGraphFileResponse {
  environmentId: string;
  path: string;
  absolutePath?: string;
  file: AgentGraphNode | null;
  language?: string;
  symbols: AgentGraphNode[];
  imports: AgentGraphNode[];
  importedBy: AgentGraphNode[];
  documentedBy: AgentGraphNode[];
  /** Prompts (latest first) that read or changed the file (references layer, when permitted). */
  prompts: AgentGraphPromptSummary[];
}

export type AgentGraphReferenceKind = 'attached' | 'available' | 'used' | 'modified';

export interface AgentGraphPromptReference {
  kind: AgentGraphReferenceKind;
  /** Node type of the referenced element (ticket, knowledge, plan, file, skill, instruction, mcp-server, ...). */
  type: AgentGraphNodeType;
  /** Stable reference (`ticket:<sha>`, `file:<relative path>`, `skill:<name>`, ...). */
  ref: string;
  label: string;
  /** Path relative to the environment's working directory or absolute (for files outside it). */
  path?: string;
  /** Tool that produced a `used` / `modified` reference. */
  tool?: string;
  /** Number of times the turn touched it. */
  count?: number;
}

export interface AgentGraphPromptSummary {
  /** Correlation id of the turn (stable per prompt). */
  id: string;
  environmentId: string;
  chatSessionId: string | null;
  messageId: string | null;
  /** Visible chat, hidden helper session (task run / handoff / plan) or ephemeral prompt. */
  origin: 'chat' | 'hidden' | 'ephemeral';
  /** Short excerpt of the prompt (omitted for other environments). */
  excerpt?: string;
  startedAt: string;
  finishedAt: string | null;
  counts: Record<AgentGraphReferenceKind, number>;
}

export interface AgentGraphPromptDetail extends AgentGraphPromptSummary {
  references: AgentGraphPromptReference[];
}

export interface AgentGraphReferencesResponse {
  environmentId: string;
  prompts: AgentGraphPromptSummary[];
  prompt?: AgentGraphPromptDetail;
}

/** One environment as seen by the calling agent (MCP `graph_environments`). */
export interface AgentGraphEnvironmentSummary {
  environmentId: string;
  /** Name only for the own environment and workspace peers; other mounted environments stay anonymous. */
  name?: string;
  self?: boolean;
  /** Member of the caller's workspace (controller-verified). */
  workspacePeer?: boolean;
  mountId?: string;
  mountPath?: string;
  workingDirectory?: string;
  status: AgentGraphBuildStatus;
  builtAt: string | null;
  fileCount: number;
  /** Prompt reference graphs are only readable for the own environment and workspace peers. */
  referencesReadable: boolean;
}

export interface AgentGraphEnvironmentsResponse {
  environments: AgentGraphEnvironmentSummary[];
  note?: string;
}

export interface AgentGraphRefreshResponse {
  environmentId: string;
  queued: boolean;
  status: AgentGraphBuildStatus;
}

/** Bounds shared by manager, controller and console. */
export const AGENT_GRAPH_LIMITS = {
  /** Files listed for the paths layer. */
  maxListedFiles: 50_000,
  /** Files whose content is parsed for the code layer. */
  maxParsedFiles: 8_000,
  /** Largest file parsed (bytes). */
  maxParsedFileBytes: 512 * 1024,
  /** Total bytes streamed out of a worker per build. */
  maxParsedTotalBytes: 64 * 1024 * 1024,
  /** Default / max nodes in a served document. */
  defaultDocumentNodes: 1_500,
  maxDocumentNodes: 6_000,
  maxSearchResults: 100,
  maxNeighborDepth: 3,
  maxNeighborNodes: 400,
  maxPathDepth: 10,
  maxRelationsPerDirection: 200,
  /** Prompt reference records kept per environment (oldest are dropped). */
  maxPromptRecords: 500,
  maxReferencesPerPrompt: 400,
  promptExcerptLength: 200,
  queryMaxLength: 256,
  idMaxLength: 1024,
} as const;

/** Manager endpoint (controller → manager) composing a workspace graph from controller-verified environments. */
export interface AgentGraphComposeRequest {
  environmentIds: string[];
  layer: AgentGraphQueryLayer;
  /** Nodes per environment; omitted: every node (the caller paginates the result). */
  limit?: number;
  /** Environment display names known to the controller (manager names are used otherwise). */
  names?: Record<string, string>;
}

/** Compact per-environment summary the controller folds into its workspace snapshot. */
export interface AgentGraphEnvironmentDigest {
  environmentId: string;
  status: AgentGraphStatus;
  modules: { id: string; label: string; path?: string; files: number }[];
  hubs: AgentGraphHub[];
  /** Mount ids of other environments this one references (`/opt/workspace/<id>` paths in code / prompts). */
  referencedMountIds: string[];
  mountId?: string;
}

/** Controller workspace snapshot status (global graph). */
export interface AgentGraphWorkspaceSnapshotStatus {
  clientId: string;
  status: AgentGraphBuildStatus;
  builtAt: string | null;
  error: string | null;
  nodes: number;
  edges: number;
}

/** Node ids are short strings; this keeps them printable and bounded. */
export function isValidAgentGraphNodeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= AGENT_GRAPH_LIMITS.idMaxLength &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f]/.test(value)
  );
}

export function isAgentGraphLayer(value: unknown): value is AgentGraphLayer {
  return typeof value === 'string' && (AGENT_GRAPH_LAYERS as readonly string[]).includes(value);
}

export function isAgentGraphViewLayer(value: unknown): value is AgentGraphViewLayer {
  return typeof value === 'string' && (AGENT_GRAPH_VIEW_LAYERS as readonly string[]).includes(value);
}

export function isAgentGraphQueryLayer(value: unknown): value is AgentGraphQueryLayer {
  return value === 'all' || isAgentGraphLayer(value);
}

export function isAgentGraphNodeType(value: unknown): value is AgentGraphNodeType {
  return typeof value === 'string' && (AGENT_GRAPH_NODE_TYPES as readonly string[]).includes(value);
}

export function isAgentGraphEdgeType(value: unknown): value is AgentGraphEdgeType {
  return typeof value === 'string' && (AGENT_GRAPH_EDGE_TYPES as readonly string[]).includes(value);
}

/** Workspace graphs prefix node ids with the environment id so environments never collide. */
export function scopeAgentGraphNodeId(environmentId: string, nodeId: string): string {
  return `${environmentId}::${nodeId}`;
}

export function parseScopedAgentGraphNodeId(value: string): { environmentId: string; nodeId: string } | undefined {
  const index = value.indexOf('::');

  if (index <= 0) {
    return undefined;
  }

  return { environmentId: value.slice(0, index), nodeId: value.slice(index + 2) };
}

/** Node types that anchor a graph (always ranked first so every page shows the structure). */
const AGENT_GRAPH_ANCHOR_PRIORITY: Partial<Record<AgentGraphNodeType, number>> = {
  instance: 4,
  workspace: 3,
  environment: 2,
  module: 1,
};

/**
 * Stable page order of a graph: anchors first, then by degree, then by id. Every page holds the edges whose endpoints
 * both rank before the page end and at least one inside the page, so the union of all pages is exactly the graph.
 */
export function pageAgentGraph(
  nodes: readonly AgentGraphNode[],
  edges: readonly AgentGraphEdge[],
  offset: number,
  limit: number,
  types?: ReadonlySet<AgentGraphNodeType>,
): { nodes: AgentGraphNode[]; edges: AgentGraphEdge[]; total: number; nextOffset: number | null } {
  const candidates = types && types.size > 0 ? nodes.filter((node) => types.has(node.type)) : [...nodes];
  const ids = new Set(candidates.map((node) => node.id));
  const degree = new Map<string, number>();

  for (const edge of edges) {
    if (ids.has(edge.from) && ids.has(edge.to)) {
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
      degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    }
  }

  candidates.sort(
    (a, b) =>
      (AGENT_GRAPH_ANCHOR_PRIORITY[b.type] ?? 0) - (AGENT_GRAPH_ANCHOR_PRIORITY[a.type] ?? 0) ||
      (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const start = Math.max(0, Math.floor(offset));
  const end = Math.min(candidates.length, start + Math.max(1, Math.floor(limit)));
  const rank = new Map(candidates.map((node, index) => [node.id, index]));
  const pageEdges = edges.filter((edge) => {
    const from = rank.get(edge.from);
    const to = rank.get(edge.to);

    if (from === undefined || to === undefined) {
      return false;
    }

    const later = Math.max(from, to);

    return later >= start && later < end;
  });

  return {
    nodes: candidates.slice(start, end),
    edges: pageEdges,
    total: candidates.length,
    nextOffset: end < candidates.length ? end : null,
  };
}

/** Merge graph documents / pages (nodes by id with merged attributes, edges deduplicated). */
export function mergeAgentGraphParts(
  parts: readonly { nodes: readonly AgentGraphNode[]; edges: readonly AgentGraphEdge[] }[],
): { nodes: AgentGraphNode[]; edges: AgentGraphEdge[] } {
  const nodes = new Map<string, AgentGraphNode>();
  const edges = new Map<string, AgentGraphEdge>();

  for (const part of parts) {
    for (const node of part.nodes) {
      const existing = nodes.get(node.id);

      nodes.set(
        node.id,
        existing
          ? {
              ...node,
              ...existing,
              ...(node.attrs || existing.attrs ? { attrs: { ...(node.attrs ?? {}), ...(existing.attrs ?? {}) } } : {}),
            }
          : node,
      );
    }

    for (const edge of part.edges) {
      const key = `${edge.type}|${edge.from}|${edge.to}`;

      if (!edges.has(key)) {
        edges.set(key, edge);
      }
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
