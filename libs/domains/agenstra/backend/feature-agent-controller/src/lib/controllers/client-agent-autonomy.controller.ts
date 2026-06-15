import { type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';

import { UpsertClientAgentAutonomyDto } from '../dto/ticket-automation';
import { ClientAgentAutonomyService } from '../services/client-agent-autonomy.service';

@Controller('clients/:clientId/agents/:agentId/autonomy')
export class ClientAgentAutonomyController {
  constructor(private readonly clientAgentAutonomyService: ClientAgentAutonomyService) {}

  @Get()
  async get(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Req() req?: RequestWithUser,
  ) {
    return await this.clientAgentAutonomyService.get(clientId, agentId, req);
  }

  @Put()
  async put(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Body() dto: UpsertClientAgentAutonomyDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.clientAgentAutonomyService.upsert(clientId, agentId, dto, req);
  }
}
