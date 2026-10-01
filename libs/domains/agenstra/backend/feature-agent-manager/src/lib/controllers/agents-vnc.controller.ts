import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import { CreateVncSessionResponseDto } from '../dto/create-vnc-session-response.dto';
import { VncSessionsService } from '../services/vnc-sessions.service';

/**
 * Mint short-lived VNC WebSocket tickets for an agent's container desktop.
 */
@Controller('agents/:agentId/vnc')
export class AgentsVncController {
  constructor(private readonly vncSessionsService: VncSessionsService) {}

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ): Promise<CreateVncSessionResponseDto> {
    return await this.vncSessionsService.createSession(agentId);
  }
}
