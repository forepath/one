import {
  AGENT_GRAPH_LIMITS,
  mergeAgentGraphParts,
  pageAgentGraph,
  type AgentGraphDocument,
  type AgentGraphEdge,
  type AgentGraphNode,
  type AgentGraphScope,
  type AgentGraphViewLayer,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger } from '@nestjs/common';

import { ClientsRepository } from '../repositories/clients.repository';
import {
  attachWorkspaceToComposedGraph,
  buildCrossEnvironmentReferenceEdges,
  filterGraphByScopes,
  filterGraphPartByScopes,
  truncateGraphError,
  type GraphScopeCheck,
} from '../utils/workspace-graph.utils';

import { ClientAgentGraphProxyService } from './client-agent-graph-proxy.service';
import { WorkspaceGraphSnapshotService } from './workspace-graph-snapshot.service';

/** Root node of the global graph (all accessible workspaces hang below it). */
export const GLOBAL_GRAPH_ROOT_ID = 'instance';
/** Built views are kept this long so the pages of one "load all" share a single composition. */
const VIEW_CACHE_TTL_MS = 60_000;
/** A first page reuses a view built this recently (repeated reloads do not recompose every workspace). */
const VIEW_FIRST_PAGE_REUSE_MS = 10_000;
const MAX_CACHED_VIEWS = 12;
/** Workspaces composed at the same time for the global graph (each asks its agent-manager). */
const WORKSPACE_CONCURRENCY = 3;
/** Scopes that change what a view contains (part of the cache key). */
const VIEW_SCOPES = ['agent_files:read', 'agent_chats:read', 'tickets:read', 'knowledge:read'];

interface CachedView {
  builtAt: number;
  expiresAt: number;
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
}

export interface WorkspaceGraphViewRequest {
  scope: Extract<AgentGraphScope, 'workspace' | 'global'>;
  /** Workspaces the caller may access (resolved by the caller, never from request input). */
  clientIds: readonly string[];
  layer: AgentGraphViewLayer;
  offset: number;
  limit: number;
  isAllowed: GraphScopeCheck;
}

/**
 * Workspace and global graph views per layer:
 * - `code` / `paths` / `references`: the agent-managers compose the member environments of each workspace;
 * - `knowledge`: the persisted metadata snapshots (knowledge pages, tickets, plans, environment summaries);
 * - `all`: both merged (node ids are shared, so environments link their code, prompts and knowledge).
 * The full view is built once, cached briefly and served in pages (`pageAgentGraph`).
 */
@Injectable()
export class WorkspaceGraphViewService {
  private readonly logger = new Logger(WorkspaceGraphViewService.name);
  private readonly cache = new Map<string, CachedView>();
  private readonly inflight = new Map<string, Promise<CachedView>>();

  constructor(
    private readonly snapshots: WorkspaceGraphSnapshotService,
    private readonly graphProxy: ClientAgentGraphProxyService,
    private readonly clientsRepository: ClientsRepository,
  ) {}

  async page(request: WorkspaceGraphViewRequest): Promise<AgentGraphDocument> {
    const view = await this.view(request);
    const limit = Math.min(Math.max(1, request.limit), AGENT_GRAPH_LIMITS.maxDocumentNodes);
    const page = pageAgentGraph(view.nodes, view.edges, request.offset, limit);

    return {
      version: 1,
      scope: request.scope,
      layer: request.layer,
      ...(request.scope === 'workspace' && request.clientIds[0] ? { clientId: request.clientIds[0] } : {}),
      generatedAt: new Date().toISOString(),
      nodes: page.nodes,
      edges: page.edges,
      truncated: page.nextOffset !== null,
      totalNodes: page.total,
      totalEdges: view.edges.length,
      offset: request.offset,
      nextOffset: page.nextOffset,
    };
  }

  private async view(request: WorkspaceGraphViewRequest): Promise<CachedView> {
    const ids = [...new Set(request.clientIds)].sort();
    const scopeKey = VIEW_SCOPES.map((scope) => (request.isAllowed(scope) ? '1' : '0')).join('');
    const key = `${request.scope}|${request.layer}|${scopeKey}|${ids.join(',')}`;
    const cached = this.cache.get(key);

    // Later pages reuse the view their first page built; a new "first page" request rebuilds unless the view is only
    // seconds old.
    const now = Date.now();

    if (cached && cached.expiresAt > now && (request.offset > 0 || now - cached.builtAt < VIEW_FIRST_PAGE_REUSE_MS)) {
      return cached;
    }

    const running = this.inflight.get(key);

    if (running) {
      return await running;
    }

    const promise = this.build(ids, request.layer, request.isAllowed, request.scope)
      .then((built) => {
        const view = { ...built, builtAt: Date.now(), expiresAt: Date.now() + VIEW_CACHE_TTL_MS };

        this.cache.delete(key);
        this.cache.set(key, view);

        while (this.cache.size > MAX_CACHED_VIEWS) {
          this.cache.delete(this.cache.keys().next().value as string);
        }

        return view;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);

    return await promise;
  }

  private async build(
    clientIds: readonly string[],
    layer: AgentGraphViewLayer,
    isAllowed: GraphScopeCheck,
    scope: WorkspaceGraphViewRequest['scope'],
  ): Promise<{ nodes: AgentGraphNode[]; edges: AgentGraphEdge[] }> {
    const parts: { nodes: AgentGraphNode[]; edges: AgentGraphEdge[] }[] = [];
    let next = 0;
    const worker = async () => {
      while (next < clientIds.length) {
        const clientId = clientIds[next++];

        parts.push(await this.workspacePart(clientId, layer, isAllowed));
      }
    };

    await Promise.all(Array.from({ length: Math.min(WORKSPACE_CONCURRENCY, clientIds.length) }, worker));

    const merged = mergeAgentGraphParts(parts);

    // Environments of different workspaces on the same agent-manager that used each other's mounts (derived from
    // prompts: chats scope only).
    if (isAllowed('agent_chats:read')) {
      merged.edges.push(...buildCrossEnvironmentReferenceEdges(merged.nodes, merged.edges));
    }

    // Final guard: nothing outside the caller's content scopes, whichever part it came from.
    const scoped = filterGraphPartByScopes(merged.nodes, merged.edges, isAllowed);

    merged.nodes = scoped.nodes;
    merged.edges = scoped.edges;

    // Star topology: the global graph has one root above every workspace.
    if (scope === 'global') {
      const workspaces = merged.nodes.filter((node) => node.type === 'workspace');

      merged.nodes.unshift({
        id: GLOBAL_GRAPH_ROOT_ID,
        type: 'instance',
        label: 'All workspaces',
        attrs: { workspaces: workspaces.length },
      });
      merged.edges.push(
        ...workspaces.map((node) => ({ from: GLOBAL_GRAPH_ROOT_ID, to: node.id, type: 'contains' as const })),
      );
    }

    return mergeAgentGraphParts([merged]);
  }

  /** One workspace of a view; a failing agent-manager degrades to the knowledge snapshot (or an empty part). */
  private async workspacePart(
    clientId: string,
    layer: AgentGraphViewLayer,
    isAllowed: GraphScopeCheck,
  ): Promise<{ nodes: AgentGraphNode[]; edges: AgentGraphEdge[] }> {
    const parts: { nodes: AgentGraphNode[]; edges: AgentGraphEdge[] }[] = [];
    let composed = false;

    if (layer !== 'knowledge') {
      try {
        const memberAgentIds = await this.snapshots.listMemberAgentIds(clientId);
        const client = await this.clientsRepository.findById(clientId);

        if (memberAgentIds.length > 0) {
          const allNames = await this.snapshots.resolveEnvironmentNames(clientId);
          const names = Object.fromEntries(
            memberAgentIds.filter((agentId) => allNames[agentId]).map((agentId) => [agentId, allNames[agentId]]),
          );
          const document = await this.graphProxy.compose(clientId, {
            environmentIds: memberAgentIds,
            layer: layer === 'all' ? 'all' : layer,
            names,
          });

          const allowed = filterGraphPartByScopes(document.nodes, document.edges, isAllowed);

          parts.push(
            attachWorkspaceToComposedGraph(
              { ...document, nodes: allowed.nodes, edges: allowed.edges },
              clientId,
              memberAgentIds,
              client?.name,
            ),
          );
          composed = true;
        } else {
          parts.push({
            nodes: [
              { id: `workspace:${clientId}`, type: 'workspace', label: client?.name ?? clientId, attrs: { clientId } },
            ],
            edges: [],
          });
        }
      } catch (error) {
        this.logger.debug(`Graph view skips the composition of workspace ${clientId}: ${truncateGraphError(error)}`);
      }
    }

    if (layer === 'knowledge' || layer === 'all' || !composed) {
      const snapshot = await this.snapshots.getOrBuild(clientId).catch(() => undefined);

      if (snapshot) {
        const filtered = filterGraphByScopes(snapshot, isAllowed);

        // With a composition, its real modules / languages replace the snapshot's summaries; without one (manager
        // unreachable) a non-knowledge layer still shows the workspace and its environments, nothing else.
        const keep = (node: AgentGraphNode): boolean => {
          if (layer !== 'knowledge' && layer !== 'all') {
            return node.type === 'workspace' || node.type === 'environment';
          }

          return !composed || (node.type !== 'module' && node.type !== 'language');
        };

        parts.push({ nodes: filtered.nodes.filter(keep), edges: filtered.edges });
      }
    }

    const merged = mergeAgentGraphParts(parts);
    const ids = new Set(merged.nodes.map((node) => node.id));

    return { nodes: merged.nodes, edges: merged.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)) };
  }
}
