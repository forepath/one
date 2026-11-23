import {
  getUserFromRequest,
  isAdministrativeRole,
  type RequestWithUser,
  RequireScopes,
} from '@forepath/identity/backend';
import { Controller, ForbiddenException, Get, Query, Req } from '@nestjs/common';

import type { AdminOverviewResponseDto } from '../dto/statistics/admin-overview.dto';
import { AdminOverviewService } from '../services/admin-overview.service';
import { ClientsService } from '../services/clients.service';

/**
 * Admin overview (dashboard) of the instance: admins and managers only (enforced here, like the other admin
 * controllers). The workspaces in scope are those the caller may access: every workspace for console admins and
 * managers, member workspaces for PATs (no console-admin bypass for `amr: pat`).
 */
@Controller('admin/overview')
@RequireScopes('statistics:admin')
export class AdminOverviewController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly adminOverviewService: AdminOverviewService,
  ) {}

  @Get()
  async getOverview(
    @Query('clientId') clientId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
    @Req() req?: RequestWithUser,
  ): Promise<AdminOverviewResponseDto> {
    const user = getUserFromRequest(req || ({} as RequestWithUser));

    if (!user.isApiKeyAuth && !isAdministrativeRole(user.userRole)) {
      throw new ForbiddenException('Admin only');
    }

    const accessibleClientIds = await this.clientsService.getAccessibleClientIds(
      user.userId,
      user.userRole,
      user.isApiKeyAuth,
      { amr: user.amr },
    );

    return await this.adminOverviewService.getOverview(accessibleClientIds, { clientId, from, to, groupBy });
  }
}
