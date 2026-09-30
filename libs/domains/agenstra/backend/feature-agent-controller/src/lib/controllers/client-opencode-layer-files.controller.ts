import {
  ClientUsersRepository,
  RequireScopes,
  ensureWorkspaceManagementAccess,
  type RequestWithUser,
} from '@forepath/identity/backend';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';

import {
  CreateOpencodeLayerFileDto,
  OpencodeLayerFileListResponseDto,
  OpencodeLayerFileResponseDto,
  UpsertOpencodeLayerFileDto,
} from '../dto/opencode-layer-file.dto';
import { ClientsRepository } from '../repositories/clients.repository';
import { OpencodeLayerFilesService } from '../services/opencode-layer-files.service';

@Controller('clients/:id/opencode-config/files')
export class ClientOpencodeLayerFilesController {
  constructor(
    private readonly layerFilesService: OpencodeLayerFilesService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  @Get()
  @RequireScopes('clients:read')
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Query('path') path: string | undefined,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeLayerFileListResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.layerFilesService.listWorkspace(clientId, path ?? '.');
  }

  @Post()
  @RequireScopes('clients:write')
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Body() dto: CreateOpencodeLayerFileDto,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeLayerFileResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.layerFilesService.createWorkspace(clientId, dto);
  }

  @Post('ensure')
  @RequireScopes('clients:write')
  async ensure(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Body() dto: CreateOpencodeLayerFileDto,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeLayerFileResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.layerFilesService.ensureWorkspace(clientId, dto.path, dto.entryKind);
  }

  @Get('*path')
  @RequireScopes('clients:read')
  async get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('path') path: string | string[],
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeLayerFileResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.layerFilesService.getWorkspace(clientId, this.normalizePath(path));
  }

  @Put('*path')
  @RequireScopes('clients:write')
  async put(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('path') path: string | string[],
    @Body() dto: UpsertOpencodeLayerFileDto,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeLayerFileResponseDto> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);

    return await this.layerFilesService.putWorkspace(clientId, this.normalizePath(path), dto.content ?? '');
  }

  @Delete('*path')
  @RequireScopes('clients:write')
  async delete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @Param('path') path: string | string[],
    @Req() req?: RequestWithUser,
  ): Promise<{ ok: true }> {
    await ensureWorkspaceManagementAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    await this.layerFilesService.deleteWorkspace(clientId, this.normalizePath(path));

    return { ok: true };
  }

  private normalizePath(path: string | string[]): string {
    return Array.isArray(path) ? path.join('/') : path;
  }
}
