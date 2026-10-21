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
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { CreateChatSessionDto } from '../dto/create-chat-session.dto';
import { ChatSessionResponseDto } from '../dto/chat-session-response.dto';
import { UpdateChatSessionDto } from '../dto/update-chat-session.dto';
import { AgentChatSessionsService } from '../services/agent-chat-sessions.service';

/**
 * Controller for user-visible chat sessions nested under an agent.
 */
@Controller('agents/:agentId/chats')
export class AgentsChatSessionsController {
  constructor(private readonly agentChatSessionsService: AgentChatSessionsService) {}

  @Get()
  async listChatSessions(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<ChatSessionResponseDto[]> {
    const sessions = await this.agentChatSessionsService.listSessions(agentId, limit ?? 50, offset ?? 0);

    return sessions.map((session) => this.agentChatSessionsService.mapToResponseDto(session));
  }

  @Get('count')
  async countChatSessions(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ): Promise<{ count: number }> {
    const count = await this.agentChatSessionsService.countSessions(agentId);

    return { count };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createChatSession(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() createDto: CreateChatSessionDto,
  ): Promise<ChatSessionResponseDto> {
    const session = await this.agentChatSessionsService.createUserSession(
      agentId,
      createDto.title,
      createDto.kind ?? 'user',
    );

    return this.agentChatSessionsService.mapToResponseDto(session);
  }

  @Get(':chatId')
  async getChatSession(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
  ): Promise<ChatSessionResponseDto> {
    const session = await this.agentChatSessionsService.getSession(agentId, chatId);

    return this.agentChatSessionsService.mapToResponseDto(session);
  }

  @Put(':chatId')
  async updateChatSession(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Body() updateDto: UpdateChatSessionDto,
  ): Promise<ChatSessionResponseDto> {
    const session = await this.agentChatSessionsService.updateSessionTitle(agentId, chatId, updateDto.title);

    return this.agentChatSessionsService.mapToResponseDto(session);
  }

  @Delete(':chatId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteChatSession(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
  ): Promise<void> {
    await this.agentChatSessionsService.deleteSession(agentId, chatId);
  }

  @Get(':chatId/messages')
  async listChatSessionMessages(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<
    {
      id: string;
      actor: string;
      message: string;
      filtered: boolean;
      createdAt: Date;
      updatedAt: Date;
    }[]
  > {
    return await this.agentChatSessionsService.getMessagesForSession(agentId, chatId, limit ?? 50, offset ?? 0);
  }
}
