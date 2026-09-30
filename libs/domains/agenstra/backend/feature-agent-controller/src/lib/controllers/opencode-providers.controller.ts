import { RequireScopes } from '@forepath/identity/backend';
import { Controller, Get } from '@nestjs/common';

import { OpencodeProvidersListDto } from '../dto/opencode-providers.dto';
import { OpencodeProvidersCatalogService } from '../services/opencode-providers-catalog.service';

@Controller('opencode-providers')
@RequireScopes('clients:read')
export class OpencodeProvidersController {
  constructor(private readonly catalog: OpencodeProvidersCatalogService) {}

  @Get()
  async list(): Promise<OpencodeProvidersListDto> {
    const providers = await this.catalog.listProviders();

    return { providers };
  }
}
