import {
  ClientUsersRepository,
  ensureClientAccess,
  RequireScopes,
  type RequestWithUser,
} from '@forepath/identity/backend';
import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';

import { ClientsRepository } from '../repositories/clients.repository';
import { ChatPlanService } from '../services/chat-plan.service';

@Controller('clients/:id/agents/:agentId')
export class ChatPlanController {
  constructor(
    private readonly chatPlanService: ChatPlanService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  @Get('chats/:chatId/plans')
  @RequireScopes('agents:chats')
  async listByChat(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Req() req?: RequestWithUser,
  ) {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.chatPlanService.listByChat(clientId, agentId, chatId, req);
  }

  @Get('plans/:planId')
  @RequireScopes('agents:chats')
  async getPlan(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Req() req?: RequestWithUser,
  ) {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.chatPlanService.get(clientId, agentId, planId, req);
  }

  @Post('plans/:planId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('agents:chats')
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
