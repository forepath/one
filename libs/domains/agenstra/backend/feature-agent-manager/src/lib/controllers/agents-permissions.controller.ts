import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  Param,
  ParseUUIDPipe,
  Optional,
  Post,
} from '@nestjs/common';

import { ReplyPermissionDto, ReplyQuestionDto } from '../dto/reply-permission.dto';
import { AgentsGateway } from '../gateways/agents.gateway';
import { OpenCodeRuntimeService } from '../providers/opencode/opencode-runtime.service';
import { AgentsRepository } from '../repositories/agents.repository';
import { AgentContextAccessService } from '../services/agent-context-access.service';
import { AgentContextApiService } from '../services/agent-context-api.service';
import { AgentContextChangesService } from '../services/agent-context-changes.service';
import { AgentDeploymentActionsService } from '../services/agent-deployment-actions.service';

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
    @Optional() private readonly contextApi?: AgentContextApiService,
    @Optional() private readonly contextChanges?: AgentContextChangesService,
    @Optional() private readonly deploymentActions?: AgentDeploymentActionsService,
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
    // Context access, content change and deployment action prompts (agenstra MCP) are decided by the manager, not by
    // OpenCode.
    if (this.contextApi && AgentContextAccessService.isAccessRequestId(permissionId)) {
      if (!(await this.agentsRepository.findById(agentId))) {
        throw new NotFoundException(`Agent '${agentId}' was not found`);
      }

      if (dto.reply !== 'once' && dto.reply !== 'always' && dto.reply !== 'reject') {
        throw new BadRequestException('reply must be once, always or reject');
      }

      try {
        // Content changes (`ctx_chg_`) are applied when approved; the change service marks the prompt answered.
        if (AgentContextChangesService.isChangeRequestId(permissionId)) {
          if (!this.contextChanges) {
            throw new NotFoundException('Unknown or expired content change request');
          }

          await this.contextChanges.decide(agentId, permissionId, dto.reply);

          return;
        }

        // Deployment actions (`ctx_dep_`) are carried out when approved; the actions service marks the prompt answered.
        if (AgentDeploymentActionsService.isDeploymentRequestId(permissionId)) {
          if (!this.deploymentActions) {
            throw new NotFoundException('Unknown or expired deployment action request');
          }

          await this.deploymentActions.decide(agentId, permissionId, dto.reply);

          return;
        }

        const answeredIds = this.contextApi.decideAccess(agentId, permissionId, dto.reply);

        this.agentsGateway.publishInteractionAnswered(
          agentId,
          answeredIds,
          `Context access ${permissionId}: ${dto.reply}`,
        );
      } catch (error) {
        const message = (error as { message?: string }).message ?? 'Context access reply failed';

        throw new BadRequestException(message);
      }

      return;
    }

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
    if (this.contextApi && AgentContextAccessService.isAccessRequestId(questionId)) {
      // Older consoles may answer context prompts as a form question: map the chosen option.
      const answer = dto.reply === 'reject' ? 'reject' : dto.answers?.[0];

      return this.replyPermission(agentId, questionId, {
        reply: answer === 'once' || answer === 'always' ? answer : 'reject',
      });
    }

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
