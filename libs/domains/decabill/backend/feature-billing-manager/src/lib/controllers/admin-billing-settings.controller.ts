import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import type { SettingsOverviewResponse, SettingStateView } from '@forepath/shared/backend/util-settings-overrides';
import { Body, Controller, Delete, Get, Param, Put, Query, Req } from '@nestjs/common';

import { BillingSettingsScopeQueryDto, UpsertBillingSettingDto } from '../dto/billing-settings.dto';
import { BillingSettingsService } from '../services/billing-settings.service';
import { getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

/** Administration → Settings: overrides of billing manager environment variables. */
@Controller('admin/billing/settings')
@UsersRoles(UserRole.ADMIN)
@RequireScopes('billing:admin')
export class AdminBillingSettingsController {
  constructor(private readonly settings: BillingSettingsService) {}

  @Get()
  async list(@Query() query: BillingSettingsScopeQueryDto): Promise<SettingsOverviewResponse> {
    return await this.settings.getOverview(query.level, query.viewTenantId);
  }

  @Put(':settingKey')
  async upsert(
    @Param('settingKey') settingKey: string,
    @Query() query: BillingSettingsScopeQueryDto,
    @Body() dto: UpsertBillingSettingDto,
    @Req() req: RequestWithUser,
  ): Promise<SettingStateView> {
    const userId = getUserFromRequest(req).userId ?? null;

    return await this.settings.upsert(settingKey, dto.value, query.level, query.viewTenantId, userId);
  }

  @Delete(':settingKey')
  async reset(
    @Param('settingKey') settingKey: string,
    @Query() query: BillingSettingsScopeQueryDto,
  ): Promise<SettingStateView> {
    return await this.settings.reset(settingKey, query.level, query.viewTenantId);
  }
}
