import { RequireScopes } from '@forepath/identity/backend';
import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';

import {
  OPENCODE_PROVIDERS_LIST_LIMIT_DEFAULT,
  OPENCODE_PROVIDERS_LIST_LIMIT_MAX,
} from '../constants/opencode-providers.constants';
import { OpencodeProviderDto, OpencodeProvidersListDto } from '../dto/opencode-providers.dto';
import { OpencodeProvidersCatalogService } from '../services/opencode-providers-catalog.service';

@Controller('opencode/providers')
@RequireScopes('clients:read')
export class OpencodeProvidersController {
  constructor(private readonly catalog: OpencodeProvidersCatalogService) {}

  @Get()
  async list(
    @Query('search') search?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<OpencodeProvidersListDto> {
    return await this.catalog.listProviders({
      search,
      limit: this.clampLimit(limit),
      offset: Math.max(0, offset ?? 0),
    });
  }

  @Get(':id')
  async getOne(@Param('id') id: string): Promise<OpencodeProviderDto> {
    return await this.catalog.getProviderOrThrow(id);
  }

  private clampLimit(limit?: number): number {
    if (limit == null || Number.isNaN(limit)) {
      return OPENCODE_PROVIDERS_LIST_LIMIT_DEFAULT;
    }

    return Math.min(OPENCODE_PROVIDERS_LIST_LIMIT_MAX, Math.max(1, limit));
  }
}
