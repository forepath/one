import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import { Controller, Get, Query } from '@nestjs/common';

import type { AdminOverviewResponseDto } from '../dto/admin-overview.dto';
import { AdminOverviewService } from '../services/admin-overview.service';

/** Admin dashboard: key figures of the request tenant, another tenant or all tenants (TENANTS_ALLOW_GLOBAL_VIEWS). */
@Controller('admin/billing/overview')
@UsersRoles(UserRole.ADMIN)
@RequireScopes('billing:admin')
export class AdminOverviewController {
  constructor(private readonly adminOverviewService: AdminOverviewService) {}

  @Get()
  async getOverview(
    @Query('viewTenantId') viewTenantId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
  ): Promise<AdminOverviewResponseDto> {
    return await this.adminOverviewService.getOverview({ viewTenantId, from, to, groupBy });
  }
}
