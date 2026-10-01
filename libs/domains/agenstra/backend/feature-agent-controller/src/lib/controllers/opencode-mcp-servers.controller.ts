import { RequireScopes } from '@forepath/identity/backend';
import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';

import {
  OPENCODE_MCP_SERVERS_LIST_LIMIT_DEFAULT,
  OPENCODE_MCP_SERVERS_LIST_LIMIT_MAX,
} from '../constants/opencode-mcp-servers.constants';
import { OpencodeMcpServerDto, OpencodeMcpServersListDto } from '../dto/opencode-mcp-servers.dto';
import { OpencodeMcpServersCatalogService } from '../services/opencode-mcp-servers-catalog.service';

@Controller('opencode/mcp-servers')
@RequireScopes('clients:read')
export class OpencodeMcpServersController {
  constructor(private readonly catalog: OpencodeMcpServersCatalogService) {}

  @Get()
  async list(
    @Query('search') search?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<OpencodeMcpServersListDto> {
    return await this.catalog.listServers({
      search,
      limit: this.clampLimit(limit),
      offset: Math.max(0, offset ?? 0),
    });
  }

  @Get(':name')
  async getOne(@Param('name') name: string): Promise<OpencodeMcpServerDto> {
    return await this.catalog.getServerOrThrow(name);
  }

  private clampLimit(limit?: number): number {
    if (limit == null || Number.isNaN(limit)) {
      return OPENCODE_MCP_SERVERS_LIST_LIMIT_DEFAULT;
    }

    return Math.min(OPENCODE_MCP_SERVERS_LIST_LIMIT_MAX, Math.max(1, limit));
  }
}
