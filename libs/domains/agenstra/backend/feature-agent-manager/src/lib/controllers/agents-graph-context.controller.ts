import {
  AGENSTRA_CONTEXT_API_HEADERS,
  AGENSTRA_CONTEXT_API_ROUTE,
  AGENSTRA_GRAPH_API_SEGMENT,
  AGENT_GRAPH_LIMITS,
  type AgentGraphDocument,
  type AgentGraphEnvironmentsResponse,
  type AgentGraphFileResponse,
  type AgentGraphQueryLayer,
  type AgentGraphNode,
  type AgentGraphNodeDetail,
  type AgentGraphOverview,
  type AgentGraphPathResponse,
  type AgentGraphPromptDetail,
  type AgentGraphPromptReference,
  type AgentGraphPromptSummary,
  type AgentGraphRefreshResponse,
  type AgentGraphReferencesResponse,
  type AgentGraphSearchResponse,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Public } from '@forepath/identity/backend';
import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';

import {
  parseAgentGraphEdgeTypes,
  parseAgentGraphInt,
  parseAgentGraphLayer,
  parseAgentGraphNodeId,
  parseAgentGraphNodeTypes,
  parseAgentGraphOffset,
  parseAgentGraphOptionalString,
  parseAgentGraphQuery,
} from '../dto/agent-graph.dto';
import { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentGraphAccessService, type AgentGraphAccessTarget } from '../services/agent-graph-access.service';
import { AgentGraphReferencesService } from '../services/agent-graph-references.service';
import { AgentGraphService } from '../services/agent-graph.service';
import { authenticateAgentContextCall } from '../utils/agent-context-auth.utils';
import {
  AGENT_GRAPH_CONTROLLER_CONTENT_TYPES,
  redactAgentGraphNodeForCaller,
} from '../utils/agent-graph-redaction.utils';

const MAX_SEARCH_ENVIRONMENTS = 25;

/**
 * Agent-facing graph API used by the worker `agenstra` MCP server (`agenstra_graph_*` tools).
 *
 * Same trust model as the task / handoff APIs: user auth guards are bypassed (`@Public`), callers authenticate with
 * the per-agent context token, and every request is bound to the authenticated agent. Which environments it may read
 * is decided by {@link AgentGraphAccessService} (own environment, environments visible below `/opt/workspace`, prompt
 * references only for the own environment and workspace peers).
 */
@Public()
@Controller(`${AGENSTRA_CONTEXT_API_ROUTE}/${AGENSTRA_GRAPH_API_SEGMENT}`)
export class AgentsGraphContextController {
  constructor(
    private readonly contextMcp: AgentContextMcpService,
    private readonly access: AgentGraphAccessService,
    private readonly graphs: AgentGraphService,
    private readonly promptReferences: AgentGraphReferencesService,
  ) {}

  @Get('environments')
  async environments(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentGraphEnvironmentsResponse> {
    return this.access.environments(await this.authenticate(agentId, authorization));
  }

  @Get('overview')
  async overview(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query('environment') environment?: string,
  ): Promise<AgentGraphOverview> {
    const target = await this.target(agentId, authorization, environment);
    const overview = await this.graphs.overview(target.environmentId, {
      includePrompts: target.referencesReadable,
      base: target.base,
    });

    return {
      ...overview,
      ...(target.self ? {} : { workingDirectory: target.base.root }),
      ...(overview.recentPrompts
        ? { recentPrompts: overview.recentPrompts.map((prompt) => this.redactSummary(prompt, target)) }
        : {}),
    };
  }

  @Get('document')
  async document(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query('environment') environment?: string,
    @Query('layer') layer?: string,
    @Query('limit') limit?: string,
    @Query('types') types?: string,
    @Query('offset') offset?: string,
  ): Promise<AgentGraphDocument> {
    const target = await this.target(agentId, authorization, environment);
    const parsedLayer = this.layerFor(target, layer);
    const document = await this.graphs.document(
      target.environmentId,
      parsedLayer,
      parseAgentGraphInt(limit, 300, 1, AGENT_GRAPH_LIMITS.defaultDocumentNodes),
      parseAgentGraphNodeTypes(types),
      { offset: parseAgentGraphOffset(offset), includeReferences: target.referencesReadable },
    );

    return { ...document, nodes: document.nodes.map((node) => this.redactNode(node, target, parsedLayer)) };
  }

  /** `environment=*` searches the own environment and every reachable one (bounded). */
  @Get('search')
  async search(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query('query') query?: string,
    @Query('environment') environment?: string,
    @Query('layer') layer?: string,
    @Query('types') types?: string,
    @Query('limit') limit?: string,
  ): Promise<AgentGraphSearchResponse> {
    const callerId = await this.authenticate(agentId, authorization);
    const parsedQuery = parseAgentGraphQuery(query);
    const parsedTypes = parseAgentGraphNodeTypes(types);
    const parsedLimit = parseAgentGraphInt(limit, 20, 1, AGENT_GRAPH_LIMITS.maxSearchResults);
    const lookup = parseAgentGraphOptionalString(environment, 'environment');
    const targets: AgentGraphAccessTarget[] = [];

    if (lookup === '*') {
      const reachable = await this.access.environments(callerId);

      for (const summary of reachable.environments
        .filter((entry) => entry.status !== 'missing')
        .slice(0, MAX_SEARCH_ENVIRONMENTS)) {
        targets.push(await this.access.resolve(callerId, summary.environmentId));
      }
    } else {
      targets.push(await this.access.resolve(callerId, lookup));
    }

    const hits: AgentGraphSearchResponse['hits'] = [];
    const byType: AgentGraphSearchResponse['byType'] = {};

    for (const target of targets) {
      const parsedLayer = this.layerFor(target, layer);

      try {
        const result = await this.graphs.search(
          target.environmentId,
          parsedQuery,
          parsedLayer,
          parsedLimit,
          parsedTypes,
          target.base,
          target.referencesReadable,
        );

        hits.push(...result.hits.map((hit) => ({ ...hit, node: this.redactNode(hit.node, target, parsedLayer) })));

        for (const [type, count] of Object.entries(result.byType)) {
          byType[type as keyof typeof byType] = (byType[type as keyof typeof byType] ?? 0) + (count ?? 0);
        }
      } catch (error) {
        if (targets.length === 1) {
          throw error;
        }
      }
    }

    return { query: parsedQuery, hits: hits.sort((a, b) => b.score - a.score).slice(0, parsedLimit), byType };
  }

  @Get('nodes')
  async node(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query('id') id?: string,
    @Query('environment') environment?: string,
    @Query('layer') layer?: string,
  ): Promise<AgentGraphNodeDetail> {
    const target = await this.target(agentId, authorization, environment);
    const parsedLayer = this.layerFor(target, layer);
    const detail = await this.graphs.node(
      target.environmentId,
      parseAgentGraphNodeId(id),
      parsedLayer,
      target.base,
      target.referencesReadable,
    );
    const redact = (entry: { edge: AgentGraphNodeDetail['outgoing'][number]['edge']; node: AgentGraphNode }) => ({
      ...entry,
      node: this.redactNode(entry.node, target, parsedLayer),
    });

    return {
      ...detail,
      node: this.redactNode(detail.node, target, parsedLayer),
      outgoing: detail.outgoing.map(redact),
      incoming: detail.incoming.map(redact),
    };
  }

  @Get('neighbors')
  async neighbors(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query('id') id?: string,
    @Query('environment') environment?: string,
    @Query('layer') layer?: string,
    @Query('depth') depth?: string,
    @Query('limit') limit?: string,
    @Query('edgeTypes') edgeTypes?: string,
  ): Promise<AgentGraphDocument> {
    const target = await this.target(agentId, authorization, environment);
    const parsedLayer = this.layerFor(target, layer);
    const document = await this.graphs.neighbors(
      target.environmentId,
      parseAgentGraphNodeId(id),
      parsedLayer,
      parseAgentGraphInt(depth, 1, 1, AGENT_GRAPH_LIMITS.maxNeighborDepth, 'depth'),
      parseAgentGraphInt(limit, 60, 1, AGENT_GRAPH_LIMITS.maxNeighborNodes),
      parseAgentGraphEdgeTypes(edgeTypes),
      target.referencesReadable,
    );

    return { ...document, nodes: document.nodes.map((node) => this.redactNode(node, target, parsedLayer)) };
  }

  @Get('path')
  async path(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('environment') environment?: string,
    @Query('layer') layer?: string,
  ): Promise<AgentGraphPathResponse> {
    const target = await this.target(agentId, authorization, environment);
    const parsedLayer = this.layerFor(target, layer);
    const result = await this.graphs.path(
      target.environmentId,
      parseAgentGraphNodeId(from, 'from'),
      parseAgentGraphNodeId(to, 'to'),
      parsedLayer,
      target.referencesReadable,
    );

    return { ...result, nodes: result.nodes.map((node) => this.redactNode(node, target, parsedLayer)) };
  }

  /** `path` is absolute (`/app/...`, `/opt/workspace/<mount id>/...`) or relative to the own working directory. */
  @Get('file')
  async file(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query('path') path?: string,
    @Query('environment') environment?: string,
  ): Promise<AgentGraphFileResponse> {
    const callerId = await this.authenticate(agentId, authorization);
    const rawPath = parseAgentGraphOptionalString(path, 'path');

    if (!rawPath) {
      throw new NotFoundException('path is required');
    }

    const lookup = parseAgentGraphOptionalString(environment, 'environment');
    let target: AgentGraphAccessTarget;
    let relativePath: string;

    if (rawPath.startsWith('/')) {
      target = await this.access.resolve(callerId, rawPath);
      relativePath = target.relativePath ?? '';
    } else {
      target = await this.access.resolve(callerId, lookup);
      relativePath = rawPath.replace(/^(\.\/)+/, '');
    }

    if (!relativePath || relativePath.split('/').includes('..')) {
      throw new NotFoundException('path must name a file inside an environment you can reach');
    }

    const response = await this.graphs.file(target.environmentId, relativePath, {
      includePrompts: target.referencesReadable,
      base: target.base,
    });

    return { ...response, prompts: response.prompts.map((prompt) => this.redactSummary(prompt, target)) };
  }

  @Get('references')
  async references(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query('environment') environment?: string,
    @Query('promptId') promptId?: string,
    @Query('limit') limit?: string,
  ): Promise<AgentGraphReferencesResponse> {
    const target = await this.target(agentId, authorization, environment);

    this.access.assertReferencesReadable(target);

    const id = parseAgentGraphOptionalString(promptId, 'promptId', 128);
    const prompts = (await this.promptReferences.list(target.environmentId, parseAgentGraphInt(limit, 20, 1, 100))).map(
      (prompt) => this.redactSummary(prompt, target),
    );
    const detail = id ? await this.promptReferences.detail(target.environmentId, id) : undefined;

    if (id && !detail) {
      throw new NotFoundException(`Prompt "${id}" not found`);
    }

    return {
      environmentId: target.environmentId,
      prompts,
      ...(detail ? { prompt: this.redactDetail(detail, target) } : {}),
    };
  }

  /** Rebuild the caller's own graph (other environments rebuild on their own change signals). */
  @Post('refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  async refresh(
    @Headers(AGENSTRA_CONTEXT_API_HEADERS.agentId) agentId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<AgentGraphRefreshResponse> {
    return this.graphs.refresh(await this.authenticate(agentId, authorization));
  }

  private authenticate(agentId: string | undefined, authorization: string | undefined): Promise<string> {
    return authenticateAgentContextCall(this.contextMcp, agentId, authorization);
  }

  private async target(
    agentId: string | undefined,
    authorization: string | undefined,
    environment: string | undefined,
  ): Promise<AgentGraphAccessTarget> {
    const callerId = await this.authenticate(agentId, authorization);

    return this.access.resolve(callerId, parseAgentGraphOptionalString(environment, 'environment'));
  }

  private layerFor(target: AgentGraphAccessTarget, layer: string | undefined): AgentGraphQueryLayer {
    const parsed = parseAgentGraphLayer(layer);

    if (parsed === 'references' && !target.referencesReadable) {
      throw new ForbiddenException('Prompt references of environments outside your workspace are not available.');
    }

    return parsed;
  }

  private redactNode(
    node: AgentGraphNode,
    target: AgentGraphAccessTarget,
    layer: AgentGraphQueryLayer,
  ): AgentGraphNode {
    return redactAgentGraphNodeForCaller(node, target, layer);
  }

  private redactSummary(prompt: AgentGraphPromptSummary, target: AgentGraphAccessTarget): AgentGraphPromptSummary {
    if (target.self) {
      return prompt;
    }

    const redacted = { ...prompt };

    delete redacted.excerpt;

    return redacted;
  }

  private redactDetail(detail: AgentGraphPromptDetail, target: AgentGraphAccessTarget): AgentGraphPromptDetail {
    if (target.self) {
      return detail;
    }

    return {
      ...this.redactSummary(detail, target),
      references: detail.references.map(
        (entry): AgentGraphPromptReference =>
          AGENT_GRAPH_CONTROLLER_CONTENT_TYPES.has(entry.type) ? { ...entry, label: entry.ref } : entry,
      ),
    };
  }
}
