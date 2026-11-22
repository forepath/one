import { RequireScopes, UserRole, getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import type { SettingsOverviewResponse, SettingStateView } from '@forepath/shared/backend/util-settings-overrides';
import { Body, Controller, Delete, ForbiddenException, Get, Param, Put, Req } from '@nestjs/common';

import { UpsertControllerSettingDto } from '../dto/controller-settings.dto';
import { ControllerSettingsService } from '../services/controller-settings.service';

/** Administration → Settings: overrides of controller environment variables. */
@Controller('admin/settings')
@RequireScopes('clients:admin')
export class AdminControllerSettingsController {
  constructor(private readonly settings: ControllerSettingsService) {}

  private assertAdmin(req?: RequestWithUser): string | null {
    const user = getUserFromRequest(req || ({} as RequestWithUser));

    if (user.isApiKeyAuth) {
      return null;
    }

    if (user.userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin only');
    }

    return user.userId ?? null;
  }

  @Get()
  async list(@Req() req?: RequestWithUser): Promise<SettingsOverviewResponse> {
    this.assertAdmin(req);

    return await this.settings.getOverview();
  }

  @Put(':settingKey')
  async upsert(
    @Param('settingKey') settingKey: string,
    @Body() dto: UpsertControllerSettingDto,
    @Req() req?: RequestWithUser,
  ): Promise<SettingStateView> {
    const userId = this.assertAdmin(req);

    return await this.settings.upsert(settingKey, dto.value, userId);
  }

  @Delete(':settingKey')
  async reset(@Param('settingKey') settingKey: string, @Req() req?: RequestWithUser): Promise<SettingStateView> {
    this.assertAdmin(req);

    return await this.settings.reset(settingKey);
  }
}
