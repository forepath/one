/**
 * Security: all routes are admin-only (or API key) via {@link ContextImportController.assertAdmin}.
 * Encrypted Atlassian tokens are never returned from list/get connection APIs. The scheduler runs only
 * configs loaded from the database and does not accept arbitrary client IDs from HTTP.
 */
import { UserRole, getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';

import { AtlassianSiteConnectionResponseDto } from '../dto/context-import/atlassian-site-connection-response.dto';
import { CreateAtlassianSiteConnectionDto } from '../dto/context-import/create-atlassian-site-connection.dto';
import { CreateExternalImportConfigDto } from '../dto/context-import/create-external-import-config.dto';
import { ExternalImportConfigResponseDto } from '../dto/context-import/external-import-config-response.dto';
import { UpdateAtlassianSiteConnectionDto } from '../dto/context-import/update-atlassian-site-connection.dto';
import { UpdateExternalImportConfigDto } from '../dto/context-import/update-external-import-config.dto';
import { AtlassianImportProvider } from '../providers/import/atlassian-external-import.provider';
import { AtlassianSiteConnectionService } from '../services/atlassian-site-connection.service';
import { ContextImportOrchestratorService } from '../services/context-import-orchestrator.service';
import { ExternalImportConfigService } from '../services/external-import-config.service';
import { ExternalImportSyncMarkerService } from '../services/external-import-sync-marker.service';

@Controller('imports/atlassian')
export class ContextImportController {
  constructor(
    private readonly connections: AtlassianSiteConnectionService,
    private readonly configs: ExternalImportConfigService,
    private readonly orchestrator: ContextImportOrchestratorService,
    private readonly markers: ExternalImportSyncMarkerService,
    private readonly atlassianProvider: AtlassianImportProvider,
  ) {}

  private assertAdmin(req?: RequestWithUser): void {
    const u = getUserFromRequest(req || ({} as RequestWithUser));

    if (!u.isApiKeyAuth && u.userRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin only');
    }
  }

  @Get('connections')
  async listConnections(
    @Req() req: RequestWithUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<AtlassianSiteConnectionResponseDto[]> {
    this.assertAdmin(req);

    return await this.connections.findAll(limit ?? 10, offset ?? 0);
  }

  @Get('connections/:id')
  async getConnection(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<AtlassianSiteConnectionResponseDto> {
    this.assertAdmin(req);

    return await this.connections.findOne(id);
  }

  @Post('connections')
  @HttpCode(HttpStatus.CREATED)
  async createConnection(
    @Body() dto: CreateAtlassianSiteConnectionDto,
    @Req() req: RequestWithUser,
  ): Promise<AtlassianSiteConnectionResponseDto> {
    this.assertAdmin(req);

    return await this.connections.create(dto);
  }

  @Put('connections/:id')
  async updateConnection(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateAtlassianSiteConnectionDto,
    @Req() req: RequestWithUser,
  ): Promise<AtlassianSiteConnectionResponseDto> {
    this.assertAdmin(req);

    return await this.connections.update(id, dto);
  }

  @Delete('connections/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConnection(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    this.assertAdmin(req);

    await this.connections.delete(id);
  }

  @Post('connections/:id/test')
  async testConnection(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<{ ok: boolean; message?: string }> {
    this.assertAdmin(req);

    return await this.atlassianProvider.testConnection(id);
  }

  @Get('configs')
  async listConfigs(
    @Req() req: RequestWithUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<ExternalImportConfigResponseDto[]> {
    this.assertAdmin(req);

    return await this.configs.findAll(limit ?? 10, offset ?? 0);
  }

  @Get('configs/:id')
  async getConfig(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<ExternalImportConfigResponseDto> {
    this.assertAdmin(req);

    return await this.configs.findOne(id);
  }

  @Post('configs')
  @HttpCode(HttpStatus.CREATED)
  async createConfig(
    @Body() dto: CreateExternalImportConfigDto,
    @Req() req: RequestWithUser,
  ): Promise<ExternalImportConfigResponseDto> {
    this.assertAdmin(req);

    return await this.configs.create(dto);
  }

  @Put('configs/:id')
  async updateConfig(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateExternalImportConfigDto,
    @Req() req: RequestWithUser,
  ): Promise<ExternalImportConfigResponseDto> {
    this.assertAdmin(req);

    return await this.configs.update(id, dto);
  }

  @Delete('configs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConfig(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    this.assertAdmin(req);

    await this.configs.delete(id);
  }

  @Post('configs/:id/run')
  @HttpCode(HttpStatus.ACCEPTED)
  async runConfig(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    this.assertAdmin(req);
    await this.orchestrator.runConfigById(id);
  }

  @Delete('configs/:id/markers')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearMarkers(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    this.assertAdmin(req);
    await this.markers.deleteAllForConfig(id);
  }
}
