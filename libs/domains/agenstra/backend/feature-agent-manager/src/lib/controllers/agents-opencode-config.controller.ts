import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';

import {
  AgentOpencodeConfigResponseDto,
  OpencodeAgentsListResponseDto,
  OpencodeCommandsListResponseDto,
  SyncAgentOpencodeConfigDto,
  UpsertAgentOpencodeConfigDto,
} from '../dto/agent-opencode-config.dto';
import { OpenCodeConfigSyncService } from '../providers/opencode/opencode-config-sync.service';

@Controller('agents/:id/opencode/config')
export class AgentsOpencodeConfigController {
  constructor(private readonly syncService: OpenCodeConfigSyncService) {}

  @Get()
  async get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ): Promise<AgentOpencodeConfigResponseDto> {
    return await this.syncService.get(agentId);
  }

  @Put()
  async put(
    @Param('id', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() dto: UpsertAgentOpencodeConfigDto,
  ): Promise<AgentOpencodeConfigResponseDto> {
    return await this.syncService.put(agentId, dto);
  }

  @Post('sync')
  async sync(
    @Param('id', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() dto: SyncAgentOpencodeConfigDto,
  ): Promise<{ ok: boolean; defer?: boolean; error?: string }> {
    return await this.syncService.syncEffective(agentId, dto.config, dto.secrets ?? {});
  }

  @Get('agents')
  async listAgents(
    @Param('id', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ): Promise<OpencodeAgentsListResponseDto> {
    return await this.syncService.listAgents(agentId);
  }

  @Get('commands')
  async listCommands(
    @Param('id', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ): Promise<OpencodeCommandsListResponseDto> {
    return await this.syncService.listCommands(agentId);
  }
}
