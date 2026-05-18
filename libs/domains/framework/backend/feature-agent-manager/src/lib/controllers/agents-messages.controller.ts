import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';

import { LatestAgentMessageDto } from '../dto/latest-agent-message.dto';
import { AgentMessagesService } from '../services/agent-messages.service';

/**
 * HTTP endpoints for agent message metadata (not full chat history).
 */
@Controller('agents')
export class AgentsMessagesController {
  constructor(private readonly agentMessagesService: AgentMessagesService) {}

  @Get(':id/messages/latest-agent')
  async getLatestAgentMessage(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<LatestAgentMessageDto> {
    const latest = await this.agentMessagesService.getLatestAgentMessage(id);

    if (!latest) {
      throw new NotFoundException('No agent messages found for this environment');
    }

    return {
      id: latest.id,
      createdAt: latest.createdAt.toISOString(),
    };
  }
}
