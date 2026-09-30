import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import {
  OpencodeMcpAuthCallbackDto,
  OpencodeMcpAuthStartDto,
  OpencodeMcpAuthStartResponseDto,
  OpencodeMcpServerStatusDto,
  OpencodeMcpStatusListResponseDto,
} from '../dto/agent-opencode-config.dto';
import { OpenCodeConfigSyncService } from '../providers/opencode/opencode-config-sync.service';

/**
 * Live OpenCode MCP status + interactive OAuth for a running Environment (agent).
 * Proxies OpenCode `GET /mcp` and `/mcp/{name}/auth*`.
 */
@Controller('agents/:id/opencode/mcp')
export class AgentsOpencodeMcpController {
  constructor(private readonly syncService: OpenCodeConfigSyncService) {}

  @Get()
  async listStatuses(
    @Param('id', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ): Promise<OpencodeMcpStatusListResponseDto> {
    return await this.syncService.listMcpStatuses(agentId);
  }

  @Post(':name/auth')
  async startAuth(
    @Param('id', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('name') name: string,
    @Body() dto: OpencodeMcpAuthStartDto,
  ): Promise<OpencodeMcpAuthStartResponseDto> {
    return await this.syncService.startMcpAuth(agentId, name, dto?.redirectUri);
  }

  @Post(':name/auth/callback')
  async completeAuth(
    @Param('id', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('name') name: string,
    @Body() dto: OpencodeMcpAuthCallbackDto,
  ): Promise<OpencodeMcpServerStatusDto> {
    return await this.syncService.completeMcpAuth(agentId, name, dto.code);
  }

  @Delete(':name/auth')
  @HttpCode(HttpStatus.OK)
  async removeAuth(
    @Param('id', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('name') name: string,
  ): Promise<{ success: true }> {
    return await this.syncService.removeMcpAuth(agentId, name);
  }
}
