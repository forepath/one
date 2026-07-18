import { KeycloakRoles, RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';

import { DatevExportScope } from '../constants/datev-export.constants';
import type {
  PaginatedAdminDatevExportsResponseDto,
  TriggerDatevExportDto,
  TriggerDatevExportResponseDto,
} from '../dto/admin-datev-export.dto';
import type { AdminDatevExportListItemDto } from '../dto/admin-datev-export.dto';
import { DatevExportEnabledGuard } from '../guards/datev-export-enabled.guard';
import { DatevExportAdminService } from '../services/datev-export-admin.service';
import { getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

@Controller('admin/billing/datev-exports')
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
@RequireScopes('datev:write')
@UseGuards(DatevExportEnabledGuard)
export class AdminDatevExportsController {
  constructor(private readonly datevExportAdminService: DatevExportAdminService) {}

  @Get()
  async listExports(
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
    @Query('offset', new ParseIntPipe({ optional: true })) offset = 0,
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
    @Query('scope') scope: DatevExportScope = DatevExportScope.TENANT,
  ): Promise<PaginatedAdminDatevExportsResponseDto> {
    return await this.datevExportAdminService.listExports(scope, limit, offset, year);
  }

  @Get(':exportId')
  async getExport(@Param('exportId', ParseUUIDPipe) exportId: string): Promise<AdminDatevExportListItemDto> {
    return await this.datevExportAdminService.getExport(exportId);
  }

  @Get(':exportId/download')
  async downloadExport(@Param('exportId', ParseUUIDPipe) exportId: string): Promise<StreamableFile> {
    const { buffer, fileName } = await this.datevExportAdminService.downloadExport(exportId);

    return new StreamableFile(buffer, {
      type: 'application/zip',
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Post()
  async triggerExport(
    @Body() dto: TriggerDatevExportDto,
    @Req() req: RequestWithUser,
  ): Promise<TriggerDatevExportResponseDto> {
    const userInfo = getUserFromRequest(req);

    return await this.datevExportAdminService.triggerExport(userInfo.userId ?? 'admin', dto);
  }
}
