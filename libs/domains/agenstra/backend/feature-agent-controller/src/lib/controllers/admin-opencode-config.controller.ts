import { RequireScopes, UserRole, getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, ForbiddenException, Get, Logger, Optional, Put, Req } from '@nestjs/common';

import { OpencodeConfigResponseDto, UpsertOpencodeConfigDto } from '../dto/opencode-config.dto';
import { OpencodeConfigService } from '../services/opencode-config.service';
import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { OpencodeConfigSyncTargetsService } from '../services/opencode-config-sync-targets.service';
import { hasAgentConfigChanges, summarizeAgentConfigChange } from '../utils/agent-config-change.utils';

@Controller('admin/opencode/config')
@RequireScopes('clients:write')
export class AdminOpencodeConfigController {
  private readonly logger = new Logger(AdminOpencodeConfigController.name);

  constructor(
    private readonly opencodeConfigService: OpencodeConfigService,
    private readonly configSyncTargets: OpencodeConfigSyncTargetsService,
    @Optional() private readonly notificationPublisher?: AgenstraNotificationPublisher,
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

    const before = await this.opencodeConfigService.getGlobal();
    const response = await this.opencodeConfigService.putGlobal(dto);
    const summary = summarizeAgentConfigChange(before, response, dto.secrets);

    if (hasAgentConfigChanges(summary)) {
      this.notificationPublisher?.publishAgentConfigUpdated({
        layer: 'global',
        clientId: null,
        agentId: null,
        ...summary,
        updatedByUserId: getUserFromRequest(req || ({} as RequestWithUser)).userId ?? null,
      });
    }

    void this.configSyncTargets.markAndProcessAll().catch((error: unknown) => {
      const err = error as { message?: string };

      this.logger.warn(`Cascade OpenCode config sync failed after global PUT: ${err.message ?? 'unknown'}`);
    });

    return response;
  }
}
