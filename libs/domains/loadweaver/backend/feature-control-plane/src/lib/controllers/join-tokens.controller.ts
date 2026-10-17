import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';

import { CreateJoinTokenDto, type CreatedJoinTokenDto, type JoinTokenResponseDto } from '../dto/join-token.dto';
import { actorFromRequest } from '../services/audit-log.service';
import { ClusterAccessService } from '../services/cluster-access.service';
import { JoinTokensService } from '../services/join-tokens.service';

/**
 * Join tokens for the one-line installer (3.21). Infra operators and cluster admins only.
 */
@Controller('join-tokens')
export class JoinTokensController {
  constructor(
    private readonly tokens: JoinTokensService,
    private readonly access: ClusterAccessService,
  ) {}

  @Post()
  @RequireScopes('cluster:nodes')
  async create(@Body() dto: CreateJoinTokenDto, @Req() req?: RequestWithUser): Promise<CreatedJoinTokenDto> {
    await this.access.assert(req, 'infra');

    return await this.tokens.create(dto, actorFromRequest(req));
  }

  @Get()
  @RequireScopes('cluster:nodes')
  async list(@Req() req?: RequestWithUser): Promise<JoinTokenResponseDto[]> {
    await this.access.assert(req, 'infra');

    return await this.tokens.listActive();
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('cluster:nodes')
  async revoke(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await this.access.assert(req, 'infra');
    await this.tokens.revoke(id, actorFromRequest(req));
  }
}
