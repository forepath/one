import {
  RunVerifierCommandsDto,
  RunVerifierCommandsResponseDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import {
  ClientUsersRepository,
  ensureClientAccess,
  RequireScopes,
  type RequestWithUser,
} from '@forepath/identity/backend';
import { Body, Controller, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';

import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentVcsProxyService } from '../services/client-agent-vcs-proxy.service';

/**
 * Proxies ticket-automation verification HTTP calls to the client's agent-manager.
 */
@Controller('clients/:clientId/agents/:agentId/automation')
export class ClientsAgentAutomationProxyController {
  constructor(
    private readonly clientAgentVcsProxyService: ClientAgentVcsProxyService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  @Post('verify-commands')
  @RequireScopes('agents:vcs')
  async verifyCommands(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() body: RunVerifierCommandsDto,
    @Req() req?: RequestWithUser,
  ): Promise<RunVerifierCommandsResponseDto> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.clientAgentVcsProxyService.runVerifierCommands(clientId, agentId, body);
  }
}
