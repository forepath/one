import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { ReplyPermissionDto, ReplyQuestionDto } from '../dto/reply-permission.dto';
import { AgentsGateway } from '../gateways/agents.gateway';
import { OpenCodeRuntimeService } from '../providers/opencode/opencode-runtime.service';
import { AgentsRepository } from '../repositories/agents.repository';

/**
 * HTTP endpoints for OpenCode permission and question replies.
 * Controller proxies these; ChatFilter stack is untouched.
 */
@Controller('agents')
export class AgentsPermissionsController {
  constructor(
    private readonly agentsRepository: AgentsRepository,
    private readonly openCodeRuntime: OpenCodeRuntimeService,
    private readonly agentsGateway: AgentsGateway,
  ) {}

  private async requireRunningAgent(agentId: string): Promise<{ containerId: string }> {
    const agent = await this.agentsRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(`Agent '${agentId}' was not found`);
    }

    if (!agent.containerId) {
      throw new BadRequestException(`Agent '${agentId}' is not running`);
    }

    return { containerId: agent.containerId };
  }

  @Post(':id/permissions/:permissionId/reply')
  @HttpCode(HttpStatus.NO_CONTENT)
  async replyPermission(
    @Param('id', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('permissionId') permissionId: string,
    @Body() dto: ReplyPermissionDto,
  ): Promise<void> {
    const { containerId } = await this.requireRunningAgent(agentId);

    try {
      const answeredIds = await this.openCodeRuntime.replyPermission(
        agentId,
        containerId,
        permissionId,
        dto.reply,
        dto.sessionId,
      );

      this.agentsGateway.publishInteractionAnswered(agentId, answeredIds, `Permission ${permissionId}: ${dto.reply}`);
    } catch (error) {
      const message = (error as { message?: string }).message ?? 'Permission reply failed';

      throw new BadRequestException(message);
    }
  }

  @Post(':id/questions/:questionId/reply')
  @HttpCode(HttpStatus.NO_CONTENT)
  async replyQuestion(
    @Param('id', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('questionId') questionId: string,
    @Body() dto: ReplyQuestionDto,
  ): Promise<void> {
    const { containerId } = await this.requireRunningAgent(agentId);

    try {
      const answeredIds = await this.openCodeRuntime.replyQuestion(
        agentId,
        containerId,
        questionId,
        dto.answers,
        dto.reply === 'reject',
        dto.sessionId,
      );

      this.agentsGateway.publishInteractionAnswered(
        agentId,
        answeredIds,
        dto.reply === 'reject' ? `Question ${questionId}: rejected` : `Question ${questionId}: answered`,
      );
    } catch (error) {
      const message = (error as { message?: string }).message ?? 'Question reply failed';

      throw new BadRequestException(message);
    }
  }
}
