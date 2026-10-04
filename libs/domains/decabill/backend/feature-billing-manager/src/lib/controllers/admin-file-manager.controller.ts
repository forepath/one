import { KeycloakRoles, RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import { Controller, Get, Query, StreamableFile } from '@nestjs/common';

import type { AdminFileManagerListResponseDto } from '../dto/admin-file-manager.dto';
import { AdminFileManagerService } from '../services/admin-file-manager.service';

@Controller('admin/billing/files')
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
@RequireScopes('billing_admin:read')
export class AdminFileManagerController {
  constructor(private readonly adminFileManagerService: AdminFileManagerService) {}

  @Get()
  async listDirectory(
    @Query('path') path?: string,
    @Query('view') view?: string,
    @Query('viewTenantId') viewTenantId?: string,
  ): Promise<AdminFileManagerListResponseDto> {
    return await this.adminFileManagerService.listDirectory(path, view, viewTenantId);
  }

  @Get('download')
  async downloadFile(
    @Query('path') path?: string,
    @Query('view') view?: string,
    @Query('viewTenantId') viewTenantId?: string,
  ): Promise<StreamableFile> {
    const { buffer, fileName, contentType } = await this.adminFileManagerService.downloadFile(path, view, viewTenantId);

    return new StreamableFile(buffer, {
      type: contentType ?? 'application/octet-stream',
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Get('archive')
  async downloadArchive(
    @Query('path') path?: string,
    @Query('view') view?: string,
    @Query('viewTenantId') viewTenantId?: string,
  ): Promise<StreamableFile> {
    const { buffer, fileName } = await this.adminFileManagerService.downloadArchive(path, view, viewTenantId);

    return new StreamableFile(buffer, {
      type: 'application/zip',
      disposition: `attachment; filename="${fileName}"`,
    });
  }
}
