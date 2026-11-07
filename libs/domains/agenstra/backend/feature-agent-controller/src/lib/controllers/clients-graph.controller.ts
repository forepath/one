import {
  AGENT_GRAPH_LIMITS,
  type AgentGraphDocument,
  type AgentGraphFileResponse,
  type AgentGraphNodeDetail,
  type AgentGraphOverview,
  type AgentGraphPathResponse,
  type AgentGraphReferencesResponse,
  type AgentGraphRefreshResponse,
  type AgentGraphSearchResponse,
  type AgentGraphStatus,
  type AgentGraphWorkspaceSnapshotStatus,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  assertPatScopes,
  ClientUsersRepository,
  ensureClientAccess,
  getUserFromRequest,
  RequireScopes,
  type RequestWithUser,
} from '@forepath/identity/backend';
import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';

import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentGraphProxyService } from '../services/client-agent-graph-proxy.service';
import { ClientsService } from '../services/clients.service';
import { WorkspaceGraphSnapshotService } from '../services/workspace-graph-snapshot.service';
import { WorkspaceGraphViewService } from '../services/workspace-graph-view.service';
import {
  clampGraphInt,
  createGraphScopeCheck,
  filterGraphByScopes,
  filterNodeDetailByScopes,
  filterPathByScopes,
  filterPromptReferencesByScopes,
  filterSearchByScopes,
  parseGraphLayer,
  parseGraphViewLayer,
  requiredScopesForGraphLayer,
  type GraphScopeCheck,
} from '../utils/workspace-graph.utils';

/** Code / paths graphs mirror the environment's files. */
const FILES_SCOPE = 'agent_files:read';
/** Prompt reference graphs mirror chats. */
const CHATS_SCOPE = 'agent_chats:read';

/**
 * Environment graphs: per-environment graphs (proxied to the agent-manager), composed workspace graphs, persisted
 * workspace metadata snapshots and the global graph over every workspace the caller may access.
 * Per-environment routes live below `clients/:id/agents/:agentId`, so {@link ClientAgentMembershipInterceptor}
 * limits them to the workspace's own environments. Graph data mirrors other resources, so PAT callers also need
 * the scopes of the mirrored resource (files, chats, tickets, knowledge).
 */
@Controller()
export class ClientsGraphController {
  constructor(
    private readonly graphProxy: ClientAgentGraphProxyService,
    private readonly snapshots: WorkspaceGraphSnapshotService,
    private readonly views: WorkspaceGraphViewService,
    private readonly clientsService: ClientsService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  private async ensureAccess(clientId: string, req?: RequestWithUser): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
  }

  /** Require mirrored-resource scopes for PAT callers (no-op for interactive sessions and the API key). */
  private requireScopes(req: RequestWithUser | undefined, ...scopes: string[]): void {
    assertPatScopes(getUserFromRequest(req || ({} as RequestWithUser)), ...scopes);
  }

  /** Files scope, plus chats scope when the references layer is requested. */
  private requireLayerScopes(req: RequestWithUser | undefined, layer: unknown): void {
    const parsed = parseGraphLayer(layer);

    this.requireScopes(
      req,
      ...(parsed === 'references' || parsed === 'all' ? [FILES_SCOPE, CHATS_SCOPE] : [FILES_SCOPE]),
    );
  }

  private mayReadChats(req: RequestWithUser | undefined): boolean {
    return this.scopeCheck(req)(CHATS_SCOPE);
  }

  /** PAT scope check for content filtering (always true for interactive sessions and the API key). */
  private scopeCheck(req: RequestWithUser | undefined): GraphScopeCheck {
    return createGraphScopeCheck(getUserFromRequest(req || ({} as RequestWithUser)));
  }

  @Get('clients/:id/agents/:agentId/graph/status')
  @RequireScopes('graph:read')
  async getEnvironmentGraphStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentGraphStatus> {
    await this.ensureAccess(id, req);

    return await this.graphProxy.getStatus(id, agentId);
  }

  @Get('clients/:id/agents/:agentId/graph/overview')
  @RequireScopes('graph:read')
  async getEnvironmentGraphOverview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentGraphOverview> {
    await this.ensureAccess(id, req);
    this.requireScopes(req, FILES_SCOPE);
    const overview = await this.graphProxy.getOverview(id, agentId);

    // Prompt summaries mirror chats.
    return this.mayReadChats(req) ? overview : { ...overview, recentPrompts: undefined };
  }

  @Get('clients/:id/agents/:agentId/graph')
  @RequireScopes('graph:read')
  async getEnvironmentGraph(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('layer') layer?: string,
    @Query('limit') limit?: string,
    @Query('types') types?: string,
    @Query('offset') offset?: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentGraphDocument> {
    await this.ensureAccess(id, req);
    this.requireLayerScopes(req, layer);

    // Prompt references may name tickets / knowledge / plans: only within the caller's content scopes.
    return filterGraphByScopes(
      await this.graphProxy.getDocument(id, agentId, { layer, limit, types, offset }),
      this.scopeCheck(req),
    );
  }

  @Get('clients/:id/agents/:agentId/graph/search')
  @RequireScopes('graph:read')
  async searchEnvironmentGraph(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('query') query?: string,
    @Query('layer') layer?: string,
    @Query('types') types?: string,
    @Query('limit') limit?: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentGraphSearchResponse> {
    await this.ensureAccess(id, req);
    this.requireLayerScopes(req, layer);

    return filterSearchByScopes(
      await this.graphProxy.search(id, agentId, { query, layer, types, limit }),
      this.scopeCheck(req),
    );
  }

  @Get('clients/:id/agents/:agentId/graph/nodes')
  @RequireScopes('graph:read')
  async getEnvironmentGraphNode(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('id') nodeId?: string,
    @Query('layer') layer?: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentGraphNodeDetail> {
    await this.ensureAccess(id, req);
    this.requireLayerScopes(req, layer);

    return filterNodeDetailByScopes(
      await this.graphProxy.getNode(id, agentId, { id: nodeId, layer }),
      this.scopeCheck(req),
    );
  }

  @Get('clients/:id/agents/:agentId/graph/neighbors')
  @RequireScopes('graph:read')
  async getEnvironmentGraphNeighbors(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('id') nodeId?: string,
    @Query('layer') layer?: string,
    @Query('depth') depth?: string,
    @Query('limit') limit?: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentGraphDocument> {
    await this.ensureAccess(id, req);
    this.requireLayerScopes(req, layer);

    return filterGraphByScopes(
      await this.graphProxy.getNeighbors(id, agentId, { id: nodeId, layer, depth, limit }),
      this.scopeCheck(req),
    );
  }

  @Get('clients/:id/agents/:agentId/graph/path')
  @RequireScopes('graph:read')
  async getEnvironmentGraphPath(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('layer') layer?: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentGraphPathResponse> {
    await this.ensureAccess(id, req);
    this.requireLayerScopes(req, layer);

    return filterPathByScopes(await this.graphProxy.getPath(id, agentId, { from, to, layer }), this.scopeCheck(req));
  }

  @Get('clients/:id/agents/:agentId/graph/file')
  @RequireScopes('graph:read')
  async getEnvironmentGraphFile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('path') path?: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentGraphFileResponse> {
    await this.ensureAccess(id, req);
    this.requireScopes(req, FILES_SCOPE);
    const file = await this.graphProxy.getFile(id, agentId, { path });

    return this.mayReadChats(req) ? file : { ...file, prompts: [] };
  }

  @Get('clients/:id/agents/:agentId/graph/references')
  @RequireScopes('graph:read')
  async getEnvironmentGraphReferences(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('promptId') promptId?: string,
    @Query('limit') limit?: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentGraphReferencesResponse> {
    await this.ensureAccess(id, req);
    this.requireScopes(req, CHATS_SCOPE);

    return filterPromptReferencesByScopes(
      await this.graphProxy.getReferences(id, agentId, { promptId, limit }),
      this.scopeCheck(req),
    );
  }

  @Post('clients/:id/agents/:agentId/graph/refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireScopes('graph:write')
  async refreshEnvironmentGraph(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentGraphRefreshResponse> {
    await this.ensureAccess(id, req);

    return await this.graphProxy.refresh(id, agentId);
  }

  /**
   * Workspace graph per layer (`all` by default; `knowledge` = the persisted metadata snapshot), paginated by `offset`
   * / `limit`. Member environments are resolved here from the stored agent credentials, never from the request.
   */
  @Get('clients/:id/graph')
  @RequireScopes('graph:read')
  async getWorkspaceGraph(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('layer') layer?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentGraphDocument> {
    await this.ensureAccess(id, req);

    return await this.viewPage('workspace', [id], layer, limit, offset, req);
  }

  /** This workspace's persisted metadata graph (rebuilt lazily when missing or stale). */
  @Get('clients/:id/graph/snapshot')
  @RequireScopes('graph:read')
  async getWorkspaceGraphSnapshot(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentGraphDocument> {
    await this.ensureAccess(id, req);

    return await this.snapshots.getWorkspaceDocument(
      id,
      createGraphScopeCheck(getUserFromRequest(req || ({} as RequestWithUser))),
    );
  }

  @Post('clients/:id/graph/snapshot/refresh')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('graph:write')
  async refreshWorkspaceGraphSnapshot(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentGraphWorkspaceSnapshotStatus> {
    await this.ensureAccess(id, req);

    return await this.snapshots.refresh(id);
  }

  /** Graph over every workspace the caller may access, per layer (`all` by default), paginated like workspace graphs. */
  @Get('graph/global')
  @RequireScopes('graph:read')
  async getGlobalGraph(
    @Query('layer') layer?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Req() req?: RequestWithUser,
  ): Promise<AgentGraphDocument> {
    return await this.viewPage('global', await this.accessibleClientIds(req), layer, limit, offset, req);
  }

  @Get('graph/global/status')
  @RequireScopes('graph:read')
  async getGlobalGraphStatus(@Req() req?: RequestWithUser): Promise<AgentGraphWorkspaceSnapshotStatus[]> {
    return await this.snapshots.getStatuses(await this.accessibleClientIds(req));
  }

  private async viewPage(
    scope: 'workspace' | 'global',
    clientIds: string[],
    layer: string | undefined,
    limit: string | undefined,
    offset: string | undefined,
    req?: RequestWithUser,
  ): Promise<AgentGraphDocument> {
    const parsedLayer = parseGraphViewLayer(layer);

    this.requireScopes(req, ...requiredScopesForGraphLayer(parsedLayer));

    return await this.views.page({
      scope,
      clientIds,
      layer: parsedLayer,
      offset: clampGraphInt(offset, 0, Number.MAX_SAFE_INTEGER) ?? 0,
      limit: clampGraphInt(limit, 1, AGENT_GRAPH_LIMITS.maxDocumentNodes) ?? AGENT_GRAPH_LIMITS.defaultDocumentNodes,
      isAllowed: createGraphScopeCheck(getUserFromRequest(req || ({} as RequestWithUser))),
    });
  }

  /** Workspaces the caller may access (API key / non-PAT admin: all), mirroring `checkClientAccess`. */
  private async accessibleClientIds(req?: RequestWithUser): Promise<string[]> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    return await this.clientsService.getAccessibleClientIds(userInfo.userId, userInfo.userRole, userInfo.isApiKeyAuth, {
      amr: userInfo.amr,
    });
  }
}
