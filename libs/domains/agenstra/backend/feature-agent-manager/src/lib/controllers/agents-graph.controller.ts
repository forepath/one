import {
  AGENT_GRAPH_LIMITS,
  type AgentGraphDocument,
  type AgentGraphEnvironmentDigest,
  type AgentGraphFileResponse,
  type AgentGraphNodeDetail,
  type AgentGraphOverview,
  type AgentGraphPathResponse,
  type AgentGraphRefreshResponse,
  type AgentGraphReferencesResponse,
  type AgentGraphSearchResponse,
  type AgentGraphStatus,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import {
  parseAgentGraphComposeRequest,
  parseAgentGraphEdgeTypes,
  parseAgentGraphInt,
  parseAgentGraphLayer,
  parseAgentGraphNodeId,
  parseAgentGraphNodeTypes,
  parseAgentGraphOffset,
  parseAgentGraphOptionalString,
  parseAgentGraphQuery,
  parseAgentGraphRelativePath,
} from '../dto/agent-graph.dto';
import { AgentGraphCollectorService } from '../services/agent-graph-collector.service';
import { AgentGraphReferencesService } from '../services/agent-graph-references.service';
import { AgentGraphService } from '../services/agent-graph.service';
import { AgentsRepository } from '../repositories/agents.repository';

/**
 * Environment graphs for the agent-controller (user-facing API; protected by the manager's global auth guards).
 * The controller enforces workspace membership and user scopes before proxying here.
 */
@Controller('agents/:agentId/graph')
export class AgentsGraphController {
  constructor(
    private readonly graphs: AgentGraphService,
    private readonly promptReferences: AgentGraphReferencesService,
    private readonly collector: AgentGraphCollectorService,
    private readonly agentsRepository: AgentsRepository,
  ) {}

  /** One page of the environment graph (`offset` / `limit`; `nextOffset` names the next page). */
  @Get()
  async document(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('layer') layer?: string,
    @Query('limit') limit?: string,
    @Query('types') types?: string,
    @Query('offset') offset?: string,
  ): Promise<AgentGraphDocument> {
    return this.graphs.document(
      agentId,
      parseAgentGraphLayer(layer),
      parseAgentGraphInt(limit, AGENT_GRAPH_LIMITS.defaultDocumentNodes, 1, AGENT_GRAPH_LIMITS.maxDocumentNodes),
      parseAgentGraphNodeTypes(types),
      { offset: parseAgentGraphOffset(offset) },
    );
  }

  @Get('status')
  async status(@Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string): Promise<AgentGraphStatus> {
    return this.graphs.status(agentId);
  }

  @Get('overview')
  async overview(@Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string): Promise<AgentGraphOverview> {
    return this.graphs.overview(agentId, { includePrompts: true, base: await this.base(agentId) });
  }

  @Get('digest')
  async digest(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ): Promise<AgentGraphEnvironmentDigest> {
    return this.graphs.digest(agentId);
  }

  @Get('search')
  async search(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('query') query?: string,
    @Query('layer') layer?: string,
    @Query('types') types?: string,
    @Query('limit') limit?: string,
  ): Promise<AgentGraphSearchResponse> {
    return this.graphs.search(
      agentId,
      parseAgentGraphQuery(query),
      parseAgentGraphLayer(layer),
      parseAgentGraphInt(limit, 25, 1, AGENT_GRAPH_LIMITS.maxSearchResults),
      parseAgentGraphNodeTypes(types),
      await this.base(agentId),
    );
  }

  @Get('nodes')
  async node(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('id') id?: string,
    @Query('layer') layer?: string,
  ): Promise<AgentGraphNodeDetail> {
    return this.graphs.node(agentId, parseAgentGraphNodeId(id), parseAgentGraphLayer(layer), await this.base(agentId));
  }

  @Get('neighbors')
  async neighbors(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('id') id?: string,
    @Query('layer') layer?: string,
    @Query('depth') depth?: string,
    @Query('limit') limit?: string,
    @Query('edgeTypes') edgeTypes?: string,
  ): Promise<AgentGraphDocument> {
    return this.graphs.neighbors(
      agentId,
      parseAgentGraphNodeId(id),
      parseAgentGraphLayer(layer),
      parseAgentGraphInt(depth, 1, 1, AGENT_GRAPH_LIMITS.maxNeighborDepth, 'depth'),
      parseAgentGraphInt(limit, 150, 1, AGENT_GRAPH_LIMITS.maxNeighborNodes),
      parseAgentGraphEdgeTypes(edgeTypes),
    );
  }

  @Get('path')
  async path(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('layer') layer?: string,
  ): Promise<AgentGraphPathResponse> {
    return this.graphs.path(
      agentId,
      parseAgentGraphNodeId(from, 'from'),
      parseAgentGraphNodeId(to, 'to'),
      parseAgentGraphLayer(layer),
    );
  }

  @Get('file')
  async file(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('path') path?: string,
  ): Promise<AgentGraphFileResponse> {
    const base = await this.base(agentId);

    return this.graphs.file(agentId, parseAgentGraphRelativePath(path, base.root ?? '/app'), {
      includePrompts: true,
      base,
    });
  }

  @Get('references')
  async references(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('promptId') promptId?: string,
    @Query('limit') limit?: string,
  ): Promise<AgentGraphReferencesResponse> {
    await this.base(agentId);

    const id = parseAgentGraphOptionalString(promptId, 'promptId', 128);
    const prompts = await this.promptReferences.list(
      agentId,
      parseAgentGraphInt(limit, 50, 1, AGENT_GRAPH_LIMITS.maxPromptRecords),
    );
    const prompt = id ? await this.promptReferences.detail(agentId, id) : undefined;

    if (id && !prompt) {
      throw new NotFoundException(`Prompt "${id}" not found`);
    }

    return { environmentId: agentId, prompts, ...(prompt ? { prompt } : {}) };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  async refresh(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ): Promise<AgentGraphRefreshResponse> {
    return this.graphs.refresh(agentId);
  }

  private async base(agentId: string): Promise<{ root: string }> {
    const agent = await this.agentsRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(`Agent with ID '${agentId}' not found`);
    }

    return { root: this.collector.workingDirectoryOf(agent) };
  }
}

/** Workspace composition: the controller passes the environments it verified as members of one workspace. */
@Controller('graphs')
export class AgentGraphsComposeController {
  constructor(private readonly graphs: AgentGraphService) {}

  @Post('compose')
  @HttpCode(HttpStatus.OK)
  async compose(@Body() body: unknown): Promise<AgentGraphDocument> {
    const request = parseAgentGraphComposeRequest(body);

    return this.graphs.compose(request.environmentIds, request.layer, request.limit, request.names);
  }
}
