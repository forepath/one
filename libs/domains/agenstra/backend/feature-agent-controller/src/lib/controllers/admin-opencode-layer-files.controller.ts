import { RequireScopes, UserRole, getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, Req } from '@nestjs/common';

import {
  CreateOpencodeLayerFileDto,
  OpencodeLayerFileListResponseDto,
  OpencodeLayerFileResponseDto,
  UpsertOpencodeLayerFileDto,
} from '../dto/opencode-layer-file.dto';
import { OpencodeLayerFilesService } from '../services/opencode-layer-files.service';

@Controller('admin/opencode/config/files')
@RequireScopes('clients:write')
export class AdminOpencodeLayerFilesController {
  constructor(private readonly layerFilesService: OpencodeLayerFilesService) {}

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
  async list(
    @Query('path') path: string | undefined,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeLayerFileListResponseDto> {
    this.assertAdmin(req);

    return await this.layerFilesService.listGlobal(path ?? '.');
  }

  @Post()
  async create(
    @Body() dto: CreateOpencodeLayerFileDto,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeLayerFileResponseDto> {
    this.assertAdmin(req);

    return await this.layerFilesService.createGlobal(dto);
  }

  @Post('ensure')
  async ensure(
    @Body() dto: CreateOpencodeLayerFileDto,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeLayerFileResponseDto> {
    this.assertAdmin(req);

    return await this.layerFilesService.ensureGlobal(dto.path, dto.entryKind);
  }

  @Get('*path')
  async get(
    @Param('path') path: string | string[],
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeLayerFileResponseDto> {
    this.assertAdmin(req);

    return await this.layerFilesService.getGlobal(this.normalizePath(path));
  }

  @Put('*path')
  async put(
    @Param('path') path: string | string[],
    @Body() dto: UpsertOpencodeLayerFileDto,
    @Req() req?: RequestWithUser,
  ): Promise<OpencodeLayerFileResponseDto> {
    this.assertAdmin(req);

    return await this.layerFilesService.putGlobal(this.normalizePath(path), dto.content ?? '');
  }

  @Delete('*path')
  async delete(@Param('path') path: string | string[], @Req() req?: RequestWithUser): Promise<{ ok: true }> {
    this.assertAdmin(req);
    await this.layerFilesService.deleteGlobal(this.normalizePath(path));

    return { ok: true };
  }

  private normalizePath(path: string | string[]): string {
    return Array.isArray(path) ? path.join('/') : path;
  }
}
