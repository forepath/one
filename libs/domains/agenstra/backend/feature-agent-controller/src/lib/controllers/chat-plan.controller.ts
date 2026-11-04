import {
  ClientUsersRepository,
  ensureClientAccess,
  RequireScopes,
  type RequestWithUser,
} from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
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

import { UpdateChatPlanDto } from '../dto/chat-plan';
import { ClientsRepository } from '../repositories/clients.repository';
import { ChatPlanService, type ChatPlanListState } from '../services/chat-plan.service';

const CHAT_PLAN_LIST_STATES: readonly ChatPlanListState[] = ['editable', 'readonly'];

@Controller('clients/:id/agents/:agentId')
export class ChatPlanController {
  constructor(
    private readonly chatPlanService: ChatPlanService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  @Get('chats/:chatId/plans')
  @RequireScopes('agent_chats:read')
  async listByChat(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Req() req?: RequestWithUser,
  ) {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.chatPlanService.listByChat(clientId, agentId, chatId, req);
  }

  /** Plans page: every plan of the agent, newest first, searchable (title, original request, plan body). */
  @Get('plans')
  @RequireScopes('agent_chats:read')
  async listForAgent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('search') search?: string,
    @Query('state') state?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ) {
    if (state && !CHAT_PLAN_LIST_STATES.includes(state as ChatPlanListState)) {
      throw new BadRequestException(`state must be one of ${CHAT_PLAN_LIST_STATES.join(', ')}`);
    }

    return await this.chatPlanService.listForAgent(
      clientId,
      agentId,
      { search, state: state as ChatPlanListState | undefined, limit, offset },
      req,
    );
  }

  @Get('plans/:planId')
  @RequireScopes('agent_chats:read')
  async getPlan(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Req() req?: RequestWithUser,
  ) {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.chatPlanService.get(clientId, agentId, planId, req);
  }

  /** Edit a plan that has not been executed yet (409 once execution started, while drafting, or on a stale version). */
  @Patch('plans/:planId')
  @RequireScopes('agent_chats:write')
  async updatePlan(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Body() dto: UpdateChatPlanDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.chatPlanService.update(clientId, agentId, planId, dto, req);
  }

  @Get('plans/:planId/activity')
  @RequireScopes('agent_chats:read')
  async listPlanActivity(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ) {
    return await this.chatPlanService.listActivity(clientId, agentId, planId, { limit, offset }, req);
  }

  @Post('plans/:planId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('agent_chats:write')
  async cancelPlan(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Req() req?: RequestWithUser,
  ) {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.chatPlanService.cancel(clientId, agentId, planId, req);
  }
}
