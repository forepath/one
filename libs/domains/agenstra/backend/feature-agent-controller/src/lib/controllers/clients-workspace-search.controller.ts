import {
  ClientUsersRepository,
  ensureClientAccess,
  RequireScopes,
  type RequestWithUser,
} from '@forepath/identity/backend';
import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';

import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentFileSystemProxyService } from '../services/client-agent-file-system-proxy.service';
import { WorkspaceSearchIndexService } from '../search/workspace-search-index.service';
import type {
  WorkspaceIndexStatusDto,
  WorkspaceSearchMode,
  WorkspaceSearchResponseDto,
} from '../search/workspace-search.types';

/**
 * Workspace code search against controller-owned OpenSearch corpora (per clientId+agentId).
 */
@Controller('clients/:id/agents/:agentId/workspace-search')
@RequireScopes('agents:files')
export class ClientsWorkspaceSearchController {
  constructor(
    private readonly workspaceSearch: WorkspaceSearchIndexService,
    private readonly fileProxy: ClientAgentFileSystemProxyService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  @Get()
  async search(
    @Param('id', ParseUUIDPipe) clientId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Query('q') q = '',
    @Query('include') includeRaw?: string | string[],
    @Query('exclude') excludeRaw?: string | string[],
    @Query('mode') modeRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
    @Req() req?: RequestWithUser,
  ): Promise<WorkspaceSearchResponseDto> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    const include = this.toList(includeRaw);
    const exclude = this.toList(excludeRaw);
    const limit = Math.min(Math.max(Number(limitRaw) || 50, 1), 100);
    const offset = Math.max(Number(offsetRaw) || 0, 0);
    const mode: WorkspaceSearchMode = modeRaw === 'files' ? 'files' : 'full';

    return this.workspaceSearch.search(clientId, agentId, q, include, exclude, offset, limit, mode);
  }

  @Get('status')
  async status(
    @Param('id', ParseUUIDPipe) clientId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Req() req?: RequestWithUser,
  ): Promise<WorkspaceIndexStatusDto> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return this.workspaceSearch.getStatus(clientId, agentId);
  }

  @Post('reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  async reindex(
    @Param('id', ParseUUIDPipe) clientId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Req() req: RequestWithUser,
  ): Promise<{ accepted: true }> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.fileProxy.signalWorkspaceIndexRebuild(clientId, agentId, req);
    void this.workspaceSearch.rebuild(clientId, agentId);

    return { accepted: true };
  }

  private toList(value?: string | string[]): string[] {
    if (!value) {
      return [];
    }

    const raw = Array.isArray(value) ? value : value.split(',');

    return raw.map((item) => item.trim()).filter(Boolean);
  }
}
