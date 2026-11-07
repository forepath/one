import {
  AGENSTRA_WORKSPACE_MOUNT_ROOT,
  AGENT_GRAPH_LIMITS,
  pageAgentGraph,
  type AgentGraphDocument,
  type AgentGraphEdgeType,
  type AgentGraphEnvironmentDigest,
  type AgentGraphFileResponse,
  type AgentGraphQueryLayer,
  type AgentGraphLayerStats,
  type AgentGraphNode,
  type AgentGraphNodeDetail,
  type AgentGraphNodeType,
  type AgentGraphOverview,
  type AgentGraphPathResponse,
  type AgentGraphRefreshResponse,
  type AgentGraphSearchResponse,
  type AgentGraphStatus,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { posix } from 'node:path';

import type { AgentGraphEntity } from '../entities/agent-graph.entity';
import type { AgentEntity } from '../entities/agent.entity';
import { AgentGraphsRepository } from '../repositories/agent-graphs.repository';
import { AgentsRepository } from '../repositories/agents.repository';
import {
  AGENT_GRAPH_ENVIRONMENT_NODE_ID,
  agentGraphFileNodeId,
  anchorAgentGraphLayerAtEnvironment,
  buildAgentGraphLayers,
  mergeAgentGraphLayers,
  type AgentGraphLayerData,
} from '../utils/agent-graph-builder.utils';
import { AgentGraphIndex } from '../utils/agent-graph-index.utils';
import { markMissingAgentGraphReferenceTargets } from '../utils/agent-graph-references.utils';

import { AgentGraphCollectorService } from './agent-graph-collector.service';
import { AgentGraphReferencesService } from './agent-graph-references.service';
import { workspaceMountIdOf } from './agent-workspace-mounts.service';
import { WorkspaceChangeNotifierService } from './workspace-change-notifier.service';

/** Quiet period after the last change signal before a background rebuild starts. */
const DIRTY_DEBOUNCE_MS = 45_000;
/** Minimum time between two builds of the same environment (background rebuilds only). */
const MIN_REBUILD_INTERVAL_MS = 2 * 60_000;
/** Manual refreshes within this window after a build (or while one runs) return the current status instead. */
export const AGENT_GRAPH_MANUAL_REFRESH_COOLDOWN_MS = 30_000;
/** Concurrent builds across all environments (each streams files out of a worker). */
const MAX_CONCURRENT_BUILDS = 2;
/** Loaded layer indexes kept in memory. */
const MAX_CACHED_GRAPHS = 6;
const REFERENCES_LAYER_PROMPTS = 100;
const OVERVIEW_HUBS = 15;
const OVERVIEW_COMMUNITIES = 12;
const OVERVIEW_MODULES = 40;
/** Set to `false` to skip rebuilding every environment graph when the manager starts. */
export const AGENT_GRAPH_STARTUP_REBUILD_ENV = 'AGENT_GRAPH_STARTUP_REBUILD';
/** Delay before the startup rebuild (workers are restarted on startup and need a moment). */
export const AGENT_GRAPH_STARTUP_DELAY_MS_ENV = 'AGENT_GRAPH_STARTUP_DELAY_MS';
const DEFAULT_STARTUP_DELAY_MS = 30_000;
/** Environments whose worker was not ready yet are retried once after this long. */
const STARTUP_RETRY_DELAY_MS = 2 * 60_000;

interface LoadedGraph {
  builtAt: number;
  code: AgentGraphIndex;
  paths: AgentGraphIndex;
  /** code + paths merged (built on first `all` request). */
  structure?: AgentGraphLayerData;
  /** Node ids of code + paths (reference targets that are not among them no longer exist). */
  ids?: ReadonlySet<string>;
}

/** How paths of an environment appear to the caller (own working directory or a read-only mount). */
export interface AgentGraphPathBase {
  /** Absolute directory the environment's relative paths are resolved against. */
  root?: string;
}

/**
 * Environment graphs: builds (lazily, on change signals and on request), stores and queries the per-environment
 * `code`, `paths` and `references` layers. Authorization happens in the callers (user API behind the manager's auth
 * guards, agent API through AgentGraphAccessService); this service trusts the environment id it is given.
 */
@Injectable()
export class AgentGraphService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AgentGraphService.name);
  private readonly builds = new Map<string, Promise<void>>();
  private readonly waiting: (() => void)[] = [];
  private running = 0;
  private readonly dirtyTimers = new Map<string, NodeJS.Timeout>();
  private readonly cache = new Map<string, LoadedGraph>();
  private unregisterInvalidator?: () => void;
  private readonly startupTimers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly agentsRepository: AgentsRepository,
    private readonly graphsRepository: AgentGraphsRepository,
    private readonly collector: AgentGraphCollectorService,
    private readonly references: AgentGraphReferencesService,
    private readonly workspaceChanges: WorkspaceChangeNotifierService,
  ) {}

  onModuleInit(): void {
    this.unregisterInvalidator = this.workspaceChanges.registerTreeInvalidator(async (agentId) =>
      this.markDirty(agentId),
    );
    this.references.registerTurnFinishedListener((agentId) => this.markDirty(agentId));
  }

  /**
   * Rebuild every environment graph after startup (and after upgrades), so graphs exist right away; from then on
   * change signals keep them current. Builds share the regular concurrency limit; environments whose worker is not
   * ready yet are retried once.
   */
  onApplicationBootstrap(): void {
    if ((process.env[AGENT_GRAPH_STARTUP_REBUILD_ENV] ?? '').trim().toLowerCase() === 'false') {
      return;
    }

    const configured = Number(process.env[AGENT_GRAPH_STARTUP_DELAY_MS_ENV]);
    const delay = Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_STARTUP_DELAY_MS;

    this.schedule(delay, () => this.rebuildAll(true));
  }

  /** Rebuild the graphs of all environments that have a worker container. */
  async rebuildAll(retryFailures = false): Promise<{ built: number; failed: string[] }> {
    const agents = await this.agentsRepository.findAllWithContainers();

    if (agents.length === 0) {
      return { built: 0, failed: [] };
    }

    this.logger.log(`Rebuilding ${agents.length} environment graph(s)`);

    for (const agent of agents) {
      this.clearDirtyTimer(agent.id);
    }

    const results = await Promise.allSettled(agents.map((agent) => this.build(agent.id)));
    const failed = agents.filter((_, index) => results[index].status === 'rejected').map((agent) => agent.id);

    this.logger.log(`Environment graphs rebuilt: ${agents.length - failed.length} ok, ${failed.length} failed`);

    if (retryFailures && failed.length > 0) {
      this.schedule(STARTUP_RETRY_DELAY_MS, async () => {
        await Promise.allSettled(failed.map((agentId) => this.build(agentId)));
      });
    }

    return { built: agents.length - failed.length, failed };
  }

  private schedule(delay: number, task: () => Promise<unknown>): void {
    const timer = setTimeout(() => {
      this.startupTimers.delete(timer);
      void task().catch((error: unknown) => {
        this.logger.warn(`Scheduled graph rebuild failed: ${String(error)}`);
      });
    }, delay);

    timer.unref?.();
    this.startupTimers.add(timer);
  }

  onModuleDestroy(): void {
    this.unregisterInvalidator?.();

    for (const timer of this.startupTimers) {
      clearTimeout(timer);
    }

    this.startupTimers.clear();

    for (const timer of this.dirtyTimers.values()) {
      clearTimeout(timer);
    }

    this.dirtyTimers.clear();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Status and builds
  // ---------------------------------------------------------------------------------------------------------------

  async status(agentId: string): Promise<AgentGraphStatus> {
    await this.requireAgent(agentId);

    return this.toStatus(agentId, await this.graphsRepository.findStatus(agentId));
  }

  async statuses(agentIds: string[]): Promise<Map<string, AgentGraphStatus>> {
    const rows = new Map((await this.graphsRepository.findStatuses(agentIds)).map((row) => [row.agentId, row]));

    return new Map(agentIds.map((id) => [id, this.toStatus(id, rows.get(id) ?? null)]));
  }

  /**
   * Queue a rebuild now (manual refresh). Bounded per environment: a running build is joined and a graph built within
   * {@link AGENT_GRAPH_MANUAL_REFRESH_COOLDOWN_MS} is current enough, so repeated refreshes cannot keep the shared
   * build slots busy.
   */
  async refresh(agentId: string): Promise<AgentGraphRefreshResponse> {
    await this.requireAgent(agentId);

    if (this.builds.has(agentId)) {
      return { environmentId: agentId, queued: false, status: 'building' };
    }

    const row = await this.graphsRepository.findStatus(agentId);

    if (
      row?.builtAt &&
      row.status === 'ready' &&
      Date.now() - row.builtAt.getTime() < AGENT_GRAPH_MANUAL_REFRESH_COOLDOWN_MS
    ) {
      return { environmentId: agentId, queued: false, status: 'ready' };
    }

    this.clearDirtyTimer(agentId);
    void this.build(agentId).catch(() => undefined);

    return { environmentId: agentId, queued: true, status: 'building' };
  }

  /**
   * Change signal (file system events, finished turns): rebuild after a quiet period, but only for graphs that were
   * built before (environments nobody looked at are not indexed in the background).
   */
  markDirty(agentId: string): void {
    void (async () => {
      const row = await this.graphsRepository.findStatus(agentId);

      if (!row?.builtAt) {
        return;
      }

      if (row.status === 'ready') {
        await this.graphsRepository.upsert(agentId, { status: 'stale' });
      }

      this.clearDirtyTimer(agentId);

      const sinceLastBuild = Date.now() - row.builtAt.getTime();
      const delay = Math.max(DIRTY_DEBOUNCE_MS, MIN_REBUILD_INTERVAL_MS - sinceLastBuild);
      const timer = setTimeout(() => {
        this.dirtyTimers.delete(agentId);
        void this.build(agentId).catch(() => undefined);
      }, delay);

      timer.unref?.();
      this.dirtyTimers.set(agentId, timer);
    })().catch((error: unknown) => {
      this.logger.debug(`Graph dirty mark for agent ${agentId} failed: ${String(error)}`);
    });
  }

  /** Single-flight build of one environment (bounded concurrency across environments). */
  build(agentId: string): Promise<void> {
    const existing = this.builds.get(agentId);

    if (existing) {
      return existing;
    }

    const run = this.withSlot(() => this.buildNow(agentId)).finally(() => this.builds.delete(agentId));

    this.builds.set(agentId, run);

    return run;
  }

  private async buildNow(agentId: string): Promise<void> {
    const agent = await this.agentsRepository.findById(agentId);

    if (!agent) {
      return;
    }

    const started = Date.now();
    const previous = await this.graphsRepository.findFull(agentId);

    await this.graphsRepository.upsert(agentId, { status: 'building' });

    try {
      const collection = await this.collector.collect(agent, previous?.parsed);
      const built = buildAgentGraphLayers({
        environmentName: agent.name,
        workingDirectory: collection.workingDirectory,
        mountPath: this.mountPathOf(agent),
        listing: collection.listing,
        parsed: collection.parsed,
      });
      const instructionFiles = built.code.nodes
        .filter((node) => node.type === 'instruction' && node.path)
        .map((node) => ({ path: node.path as string, label: node.label }));
      const builtAt = new Date();

      await this.graphsRepository.upsert(agentId, {
        status: 'ready',
        builtAt,
        buildDurationMs: Date.now() - started,
        truncated: collection.truncated,
        error: null,
        fileCount: built.fileCount,
        languages: built.languages,
        layerStats: { code: statsOf(built.code), paths: statsOf(built.paths) },
        listing: collection.listing,
        parsed: collection.parsed,
        instructionFiles,
      });
      this.remember(agentId, {
        builtAt: builtAt.getTime(),
        code: new AgentGraphIndex(built.code),
        paths: new AgentGraphIndex(anchorAgentGraphLayerAtEnvironment(built.paths, { label: agent.name })),
      });
      this.logger.debug(
        `Built graph of agent ${agentId}: ${built.fileCount} files, ${collection.streamedFiles} streamed, ${Date.now() - started} ms`,
      );
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);

      this.logger.warn(`Graph build for agent ${agentId} failed: ${message}`);
      await this.graphsRepository.upsert(agentId, {
        status: previous?.builtAt ? 'stale' : 'failed',
        error: message,
        buildDurationMs: Date.now() - started,
      });

      throw error;
    }
  }

  private async withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= MAX_CONCURRENT_BUILDS) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }

    this.running += 1;

    try {
      return await task();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }

  private clearDirtyTimer(agentId: string): void {
    const timer = this.dirtyTimers.get(agentId);

    if (timer) {
      clearTimeout(timer);
      this.dirtyTimers.delete(agentId);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Index of one layer; builds the graph first when it was never built. `all` merges code, paths and (unless
   * `includeReferences` is false) the prompt references of the environment.
   */
  async layerIndex(
    agentId: string,
    layer: AgentGraphQueryLayer,
    options: { includeReferences?: boolean } = {},
  ): Promise<AgentGraphIndex> {
    if (layer === 'references') {
      const [layerData, agent] = await Promise.all([
        this.references.layer(agentId, REFERENCES_LAYER_PROMPTS),
        this.requireAgent(agentId),
      ]);
      const references = anchorAgentGraphLayerAtEnvironment(layerData, { label: agent.name });
      const structure = await this.loadIfBuilt(agentId);

      return new AgentGraphIndex(
        structure ? markMissingAgentGraphReferenceTargets(references, structure.ids) : references,
      );
    }

    const loaded = await this.load(agentId);

    if (layer === 'all') {
      loaded.structure ??= mergeAgentGraphLayers([
        { nodes: loaded.code.nodes, edges: loaded.code.edges },
        { nodes: loaded.paths.nodes, edges: loaded.paths.edges },
      ]);

      if (options.includeReferences === false) {
        return new AgentGraphIndex(loaded.structure);
      }

      const references = await this.references.layer(agentId, REFERENCES_LAYER_PROMPTS);

      return new AgentGraphIndex(
        mergeAgentGraphLayers(
          [loaded.structure],
          markMissingAgentGraphReferenceTargets(references, this.idsOf(loaded)),
        ),
      );
    }

    return layer === 'paths' ? loaded.paths : loaded.code;
  }

  /** Loaded graph plus its node ids, or `undefined` when the environment was never built (no build is started). */
  private async loadIfBuilt(agentId: string): Promise<{ loaded: LoadedGraph; ids: ReadonlySet<string> } | undefined> {
    const row = await this.graphsRepository.findStatus(agentId);

    if (!row?.builtAt) {
      return undefined;
    }

    try {
      const loaded = await this.load(agentId);

      return { loaded, ids: this.idsOf(loaded) };
    } catch {
      return undefined;
    }
  }

  /** Ids of the current code + paths layers (cached with the loaded graph). */
  private idsOf(loaded: LoadedGraph): ReadonlySet<string> {
    loaded.ids ??= new Set([...loaded.code.nodes, ...loaded.paths.nodes].map((node) => node.id));

    return loaded.ids;
  }

  private async load(agentId: string): Promise<LoadedGraph> {
    await this.requireAgent(agentId);

    let row = await this.graphsRepository.findStatus(agentId);

    if (!row?.builtAt) {
      await this.build(agentId);
      row = await this.graphsRepository.findStatus(agentId);
    }

    if (!row?.builtAt) {
      throw new NotFoundException('The graph of this environment is not available yet');
    }

    const cached = this.cache.get(agentId);

    if (cached && cached.builtAt === row.builtAt.getTime()) {
      // Refresh LRU position.
      this.cache.delete(agentId);
      this.cache.set(agentId, cached);

      return cached;
    }

    const [full, agent] = await Promise.all([
      this.graphsRepository.findFull(agentId),
      this.agentsRepository.findById(agentId),
    ]);

    if (!full?.builtAt || !agent) {
      throw new NotFoundException('The graph of this environment is not available yet');
    }

    const built = buildAgentGraphLayers({
      environmentName: agent.name,
      workingDirectory: this.collector.workingDirectoryOf(agent),
      mountPath: this.mountPathOf(agent),
      listing: full.listing ?? [],
      parsed: full.parsed ?? {},
    });
    const loaded = {
      builtAt: full.builtAt.getTime(),
      code: new AgentGraphIndex(built.code),
      paths: new AgentGraphIndex(anchorAgentGraphLayerAtEnvironment(built.paths, { label: agent.name })),
    };

    this.remember(agentId, loaded);

    return loaded;
  }

  private remember(agentId: string, loaded: LoadedGraph): void {
    this.cache.delete(agentId);
    this.cache.set(agentId, loaded);

    while (this.cache.size > MAX_CACHED_GRAPHS) {
      const oldest = this.cache.keys().next().value as string;

      this.cache.delete(oldest);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Queries (environment scope)
  // ---------------------------------------------------------------------------------------------------------------

  /** One page of an environment graph (see `pageAgentGraph`: anchors first, then by degree). */
  async document(
    agentId: string,
    layer: AgentGraphQueryLayer,
    limit: number,
    types?: ReadonlySet<AgentGraphNodeType>,
    options: { offset?: number; includeReferences?: boolean } = {},
  ): Promise<AgentGraphDocument> {
    const index = await this.layerIndex(agentId, layer, options);
    const offset = options.offset ?? 0;
    const page = pageAgentGraph(index.nodes, index.edges, offset, limit, types);

    return {
      version: 1,
      scope: 'environment',
      layer,
      environmentId: agentId,
      generatedAt: new Date().toISOString(),
      nodes: page.nodes,
      edges: page.edges,
      truncated: page.nextOffset !== null,
      totalNodes: page.total,
      totalEdges: index.edges.length,
      offset,
      nextOffset: page.nextOffset,
    };
  }

  async overview(
    agentId: string,
    options: { includePrompts: boolean; base?: AgentGraphPathBase },
  ): Promise<AgentGraphOverview> {
    const agent = await this.requireAgent(agentId);
    const code = await this.layerIndex(agentId, 'code');
    const status = await this.status(agentId);
    const modules = code.nodes
      .filter((node) => node.type === 'module')
      .map((node) => ({
        id: node.id,
        label: node.label,
        ...(node.path ? { path: node.path } : {}),
        files: Number(node.attrs?.['files'] ?? 0),
      }))
      .sort((a, b) => b.files - a.files)
      .slice(0, OVERVIEW_MODULES);
    const instructions = code.nodes
      .filter((node) => node.type === 'instruction')
      .slice(0, 50)
      .map((node) => ({ id: node.id, label: node.label, ...(node.path ? { path: node.path } : {}) }));
    const mountPath = this.mountPathOf(agent);

    return {
      scope: 'environment',
      environmentId: agentId,
      status,
      workingDirectory: this.collector.workingDirectoryOf(agent),
      ...(mountPath ? { mountPath } : {}),
      modules,
      hubs: code.hubs(OVERVIEW_HUBS),
      communities: code.communities(OVERVIEW_COMMUNITIES),
      instructions,
      ...(options.includePrompts ? { recentPrompts: await this.references.list(agentId, 10) } : {}),
    };
  }

  async search(
    agentId: string,
    query: string,
    layer: AgentGraphQueryLayer,
    limit: number,
    types?: ReadonlySet<AgentGraphNodeType>,
    base?: AgentGraphPathBase,
    includeReferences = true,
  ): Promise<AgentGraphSearchResponse> {
    const index = await this.layerIndex(agentId, layer, { includeReferences });
    const hits = index.search(query, limit, types).map(({ node, score }) => ({
      environmentId: agentId,
      node,
      score: Math.round(score * 10) / 10,
      ...withAbsolutePath(node, base),
    }));

    return { query, hits, byType: countByType(hits.map((hit) => hit.node)) };
  }

  async node(
    agentId: string,
    id: string,
    layer: AgentGraphQueryLayer,
    base?: AgentGraphPathBase,
    includeReferences = true,
  ): Promise<AgentGraphNodeDetail> {
    const index = await this.layerIndex(agentId, layer, { includeReferences });
    const detail = index.detail(id, AGENT_GRAPH_LIMITS.maxRelationsPerDirection);

    if (!detail) {
      throw new NotFoundException(`Node "${id}" not found in the ${layer} graph`);
    }

    return { ...detail, ...withAbsolutePath(detail.node, base) };
  }

  async neighbors(
    agentId: string,
    id: string,
    layer: AgentGraphQueryLayer,
    depth: number,
    limit: number,
    edgeTypes?: ReadonlySet<AgentGraphEdgeType>,
    includeReferences = true,
  ): Promise<AgentGraphDocument> {
    const index = await this.layerIndex(agentId, layer, { includeReferences });

    if (!index.getNode(id)) {
      throw new NotFoundException(`Node "${id}" not found in the ${layer} graph`);
    }

    const slice = index.neighborhood(id, depth, limit, edgeTypes);

    return {
      version: 1,
      scope: 'environment',
      layer,
      environmentId: agentId,
      generatedAt: new Date().toISOString(),
      nodes: slice.nodes,
      edges: slice.edges,
      truncated: slice.truncated,
      totalNodes: index.nodes.length,
      totalEdges: index.edges.length,
    };
  }

  async path(
    agentId: string,
    from: string,
    to: string,
    layer: AgentGraphQueryLayer,
    includeReferences = true,
  ): Promise<AgentGraphPathResponse> {
    const index = await this.layerIndex(agentId, layer, { includeReferences });

    for (const id of [from, to]) {
      if (!index.getNode(id)) {
        throw new NotFoundException(`Node "${id}" not found in the ${layer} graph`);
      }
    }

    const found = index.shortestPath(from, to, AGENT_GRAPH_LIMITS.maxPathDepth);

    return { from, to, found: !!found, nodes: found?.nodes ?? [], edges: found?.edges ?? [] };
  }

  /** Structure around one file: symbols, imports, importers, documenting docs and the prompts that touched it. */
  async file(
    agentId: string,
    relativePath: string,
    options: { includePrompts: boolean; base?: AgentGraphPathBase },
  ): Promise<AgentGraphFileResponse> {
    const code = await this.layerIndex(agentId, 'code');
    const id = agentGraphFileNodeId(relativePath);
    const node = code.getNode(id) ?? null;
    const nodesOf = (ids: string[]) =>
      ids.map((nodeId) => code.getNode(nodeId)).filter((entry): entry is AgentGraphNode => !!entry);

    return {
      environmentId: agentId,
      path: relativePath,
      ...(options.base?.root ? { absolutePath: posix.join(options.base.root, relativePath) } : {}),
      file: node,
      ...(node?.attrs?.['language'] ? { language: String(node.attrs['language']) } : {}),
      symbols: nodesOf(code.edgesOut(id, 'defines').map((edge) => edge.to)),
      imports: nodesOf(code.edgesOut(id, 'imports').map((edge) => edge.to)).slice(
        0,
        AGENT_GRAPH_LIMITS.maxRelationsPerDirection,
      ),
      importedBy: nodesOf(code.edgesIn(id, 'imports').map((edge) => edge.from)).slice(
        0,
        AGENT_GRAPH_LIMITS.maxRelationsPerDirection,
      ),
      documentedBy: nodesOf(
        [...code.edgesIn(id, 'documents'), ...code.edgesIn(id, 'links_to')].map((edge) => edge.from),
      ),
      prompts: options.includePrompts ? await this.references.promptsReferencing(agentId, id, 20) : [],
    };
  }

  /** Compact summary the controller folds into its workspace snapshot (never builds; uses what exists). */
  async digest(agentId: string): Promise<AgentGraphEnvironmentDigest> {
    const agent = await this.requireAgent(agentId);
    const row = await this.graphsRepository.findStatus(agentId);
    const status = this.toStatus(agentId, row);
    const mountId = workspaceMountIdOf(agent.volumePath);
    let modules: AgentGraphEnvironmentDigest['modules'] = [];
    let hubs: AgentGraphEnvironmentDigest['hubs'] = [];

    if (row?.builtAt) {
      try {
        const code = (await this.load(agentId)).code;

        modules = code.nodes
          .filter((node) => node.type === 'module')
          .map((node) => ({
            id: node.id,
            label: node.label,
            ...(node.path ? { path: node.path } : {}),
            files: Number(node.attrs?.['files'] ?? 0),
          }))
          .sort((a, b) => b.files - a.files)
          .slice(0, 12);
        hubs = code.hubs(8);
      } catch (error) {
        this.logger.debug(`Digest of agent ${agentId} without modules: ${String(error)}`);
      }
    }

    return {
      environmentId: agentId,
      status,
      modules,
      hubs,
      referencedMountIds: (row?.referencedMountIds ?? []).filter((id) => id !== mountId),
      ...(mountId ? { mountId } : {}),
    };
  }

  /**
   * Workspace graph composed from environments the caller already authorized: every node id is prefixed with its
   * environment, environment roots become `environment:<id>`, and cross-environment `references` edges link
   * environments whose prompts used another environment's mount.
   */
  async compose(
    environmentIds: string[],
    layer: AgentGraphQueryLayer,
    limit: number | undefined,
    names: Record<string, string> = {},
  ): Promise<AgentGraphDocument> {
    const agents = await this.agentsRepository.findByIds(environmentIds);
    // Without a limit every node is included (the controller paginates the composed graph).
    const perEnvironmentLimit =
      limit === undefined ? Number.MAX_SAFE_INTEGER : Math.max(50, Math.floor(limit / Math.max(1, agents.length)));
    const nodes: AgentGraphNode[] = [];
    const edges: AgentGraphDocument['edges'] = [];
    let truncated = false;
    let totalNodes = 0;
    let totalEdges = 0;
    const mountOwners = new Map<string, string>();
    const referencedMounts = new Map<string, string[]>();

    for (const agent of agents) {
      const mountId = workspaceMountIdOf(agent.volumePath);

      if (mountId) {
        mountOwners.set(mountId, agent.id);
      }
    }

    for (const agent of agents) {
      const envNodeId = `environment:${agent.id}`;
      const row = await this.graphsRepository.findStatus(agent.id);

      referencedMounts.set(agent.id, row?.referencedMountIds ?? []);
      nodes.push({
        id: envNodeId,
        type: 'environment',
        label: names[agent.id] ?? agent.name,
        attrs: { environmentId: agent.id, status: row?.status ?? 'missing', fileCount: row?.fileCount ?? 0 },
      });

      if (!row?.builtAt && layer !== 'references') {
        continue;
      }

      try {
        const index = await this.layerIndex(agent.id, layer);
        const slice =
          perEnvironmentLimit >= index.nodes.length
            ? { nodes: index.nodes, edges: index.edges, truncated: false }
            : index.slice(perEnvironmentLimit);
        const scope = (id: string) => (id === AGENT_GRAPH_ENVIRONMENT_NODE_ID ? envNodeId : `${agent.id}::${id}`);

        truncated ||= slice.truncated;
        totalNodes += index.nodes.length;
        totalEdges += index.edges.length;

        for (const node of slice.nodes) {
          if (node.id === AGENT_GRAPH_ENVIRONMENT_NODE_ID) {
            continue;
          }

          nodes.push({ ...node, id: scope(node.id), attrs: { ...(node.attrs ?? {}), environmentId: agent.id } });
        }

        for (const edge of slice.edges) {
          edges.push({ ...edge, from: scope(edge.from), to: scope(edge.to) });
        }

        // Roots of the layer hang below the environment node (code / all layers already have the environment root).
        if (layer === 'paths' || layer === 'references') {
          const targets = new Set(slice.edges.map((edge) => edge.to));

          for (const node of slice.nodes) {
            if (!targets.has(node.id) && node.id !== AGENT_GRAPH_ENVIRONMENT_NODE_ID) {
              edges.push({ from: envNodeId, to: scope(node.id), type: 'contains' });
            }
          }
        }
      } catch (error) {
        this.logger.debug(`Composed graph skips agent ${agent.id}: ${String(error)}`);
      }
    }

    for (const [agentId, mountIds] of referencedMounts) {
      for (const mountId of mountIds) {
        const owner = mountOwners.get(mountId);

        if (owner && owner !== agentId) {
          edges.push({
            from: `environment:${agentId}`,
            to: `environment:${owner}`,
            type: 'references',
            confidence: 'extracted',
          });
        }
      }
    }

    return {
      version: 1,
      scope: 'workspace',
      layer,
      generatedAt: new Date().toISOString(),
      nodes,
      edges,
      truncated,
      totalNodes: totalNodes + agents.length,
      totalEdges,
    };
  }

  /** `/opt/workspace/<mount id>` of an environment (where other environments see its files). */
  mountPathOf(agent: Pick<AgentEntity, 'volumePath'>): string | undefined {
    const mountId = workspaceMountIdOf(agent.volumePath);

    return mountId ? posix.join(AGENSTRA_WORKSPACE_MOUNT_ROOT, mountId) : undefined;
  }

  private async requireAgent(agentId: string): Promise<AgentEntity> {
    const agent = await this.agentsRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(`Agent with ID '${agentId}' not found`);
    }

    return agent;
  }

  private toStatus(agentId: string, row: AgentGraphEntity | null): AgentGraphStatus {
    return {
      environmentId: agentId,
      status: this.builds.has(agentId) ? 'building' : persistedStatus(row),
      builtAt: row?.builtAt?.toISOString() ?? null,
      buildDurationMs: row?.buildDurationMs ?? null,
      truncated: row?.truncated ?? false,
      error: row?.error ?? null,
      layers: row?.layerStats ?? {},
      languages: row?.languages ?? {},
      fileCount: row?.fileCount ?? 0,
    };
  }
}

/** A persisted `building` without a running build was interrupted (restart): report what is usable. */
function persistedStatus(row: AgentGraphEntity | null): AgentGraphStatus['status'] {
  if (!row) {
    return 'missing';
  }

  if (row.status === 'building') {
    return row.builtAt ? 'stale' : 'missing';
  }

  return row.status;
}

function statsOf(layer: AgentGraphLayerData): AgentGraphLayerStats {
  return { nodes: layer.nodes.length, edges: layer.edges.length, nodesByType: countByType(layer.nodes) };
}

function countByType(nodes: AgentGraphNode[]): Partial<Record<AgentGraphNodeType, number>> {
  const counts: Partial<Record<AgentGraphNodeType, number>> = {};

  for (const node of nodes) {
    counts[node.type] = (counts[node.type] ?? 0) + 1;
  }

  return counts;
}

/** Absolute path of a node for the caller (relative paths only; absolute reference paths are kept as they are). */
function withAbsolutePath(node: AgentGraphNode, base: AgentGraphPathBase | undefined): { absolutePath?: string } {
  if (!node.path) {
    return {};
  }

  if (node.path.startsWith('/')) {
    return { absolutePath: node.path };
  }

  return base?.root ? { absolutePath: node.path === '.' ? base.root : posix.join(base.root, node.path) } : {};
}
