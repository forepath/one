import { RequireScopes, UserRole, getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, ForbiddenException, Get, Logger, Put, Req } from '@nestjs/common';

import { OpencodeConfigResponseDto, UpsertOpencodeConfigDto } from '../dto/opencode-config.dto';
import { OpencodeConfigService } from '../services/opencode-config.service';
import { OpencodeConfigSyncTargetsService } from '../services/opencode-config-sync-targets.service';

@Controller('admin/opencode/config')
@RequireScopes('clients:write')
export class AdminOpencodeConfigController {
  private readonly logger = new Logger(AdminOpencodeConfigController.name);

  constructor(
    private readonly opencodeConfigService: OpencodeConfigService,
    private readonly configSyncTargets: OpencodeConfigSyncTargetsService,
  ) {}

  private assertAdmin(req?: RequestWithUser): void {
    const u = getUserFromRequest(req || ({} as RequestWithUser));

    if (u.isApiKeyAuth) {
      return;
    }

    if (u.userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin only');
    }
  }

  @Get()
  async get(@Req() req?: RequestWithUser): Promise<OpencodeConfigResponseDto> {
    this.assertAdmin(req);

    return await this.opencodeConfigService.getGlobal();
  }

  @Put()
  async put(@Body() dto: UpsertOpencodeConfigDto, @Req() req?: RequestWithUser): Promise<OpencodeConfigResponseDto> {
    this.assertAdmin(req);

    const response = await this.opencodeConfigService.putGlobal(dto);

    void this.configSyncTargets.markAndProcessAll().catch((error: unknown) => {
      const err = error as { message?: string };

      this.logger.warn(`Cascade OpenCode config sync failed after global PUT: ${err.message ?? 'unknown'}`);
    });

    return response;
  }
}
