import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { CreateAgentTaskDto, UpdateAgentTaskDto } from '../dto/agent-tasks';
import { AgentTasksService } from '../services/agent-tasks.service';

/**
 * Recurring agent tasks of a workspace. Tasks are prompts the agent runs unattended, so every route requires
 * the chat scope (and workspace access, checked in {@link AgentTasksService}).
 */
@Controller('clients/:clientId')
export class AgentTasksController {
  constructor(private readonly agentTasksService: AgentTasksService) {}

  @Get('agent-tasks')
  @RequireScopes('agents:chats')
  async list(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Query('agentId', new ParseUUIDPipe({ version: '4', optional: true })) agentId?: string,
    @Req() req?: RequestWithUser,
  ) {
    return await this.agentTasksService.listForClient(clientId, agentId, req);
  }

  @Post('agents/:agentId/tasks')
  @RequireScopes('agents:chats')
  async create(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() dto: CreateAgentTaskDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.agentTasksService.create(clientId, agentId, dto, req);
  }

  @Get('agents/:agentId/tasks/:taskId')
  @RequireScopes('agents:chats')
  async get(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Req() req?: RequestWithUser,
  ) {
    return await this.agentTasksService.getDetail(clientId, agentId, taskId, req);
  }

  @Patch('agents/:agentId/tasks/:taskId')
  @RequireScopes('agents:chats')
  async update(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Body() dto: UpdateAgentTaskDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.agentTasksService.update(clientId, agentId, taskId, dto, req);
  }

  @Delete('agents/:agentId/tasks/:taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('agents:chats')
  async remove(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await this.agentTasksService.remove(clientId, agentId, taskId, req);
  }

  @Get('agents/:agentId/tasks/:taskId/runs')
  @RequireScopes('agents:chats')
  async listRuns(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('includeTranscript') includeTranscript?: string,
    @Req() req?: RequestWithUser,
  ) {
    return await this.agentTasksService.listRuns(
      clientId,
      agentId,
      taskId,
      { limit, offset, includeTranscript: includeTranscript === 'true' },
      req,
    );
  }

  @Post('agents/:agentId/tasks/:taskId/runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireScopes('agents:chats')
  async runNow(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Req() req?: RequestWithUser,
  ) {
    return await this.agentTasksService.runNow(clientId, agentId, taskId, req);
  }
}
