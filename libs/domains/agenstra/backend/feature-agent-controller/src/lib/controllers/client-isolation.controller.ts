import {
  ClientUsersRepository,
  RequireScopes,
  ensureClientAccess,
  ensureWorkspaceManagementAccess,
  type RequestWithUser,
} from '@forepath/identity/backend';
import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';

import type { ClientIsolationSummaryDto } from '../dto/client-isolation.dto';
import { ClientsRepository } from '../repositories/clients.repository';
import { ClientIsolationService } from '../services/client-isolation.service';

/**
 * Container isolation levels (standard Docker / gVisor sandbox) of a workspace host.
 */
@Controller('clients/:id/isolation')
export class ClientIsolationController {
  constructor(
    private readonly clientIsolation: ClientIsolationService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  /**
   * Isolation capabilities of the workspace host (recommended level, ready levels, capability revision).
   */
  @Get()
  @RequireScopes('clients:read')
  async getIsolation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<ClientIsolationSummaryDto> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientIsolation.getSummary(id);
  }

  /**
   * Re-probe the isolation capabilities of the workspace host now.
   */
  @Post('probe')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('clients:write')
  async probeIsolation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<ClientIsolationSummaryDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, id, req);

    return await this.clientIsolation.probe(id);
  }
}
