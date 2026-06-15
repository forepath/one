import { type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';

import { ClientAgentAutonomyService } from '../services/client-agent-autonomy.service';

@Controller('clients/:clientId/agent-autonomy')
export class ClientAgentAutonomyDirectoryController {
  constructor(private readonly clientAgentAutonomyService: ClientAgentAutonomyService) {}

  @Get('enabled-agent-ids')
  async listEnabledAgentIds(@Param('clientId', ParseUUIDPipe) clientId: string, @Req() req?: RequestWithUser) {
    return await this.clientAgentAutonomyService.listEnabledAgentIds(clientId, req);
  }
}
