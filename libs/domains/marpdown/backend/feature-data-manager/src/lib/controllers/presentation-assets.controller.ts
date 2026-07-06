import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';

import type { AssetContentDto, CreateAssetDto, FileNodeDto, MoveAssetDto, WriteAssetDto } from '../dto/asset.dto';
import { PresentationAssetsService } from '../services/presentation-assets.service';
import { getMarpdownUserFromRequest, type RequestWithUser } from '../utils/marpdown-access.utils';

@Controller('presentations/:presentationId/assets')
export class PresentationAssetsController {
  constructor(private readonly assetsService: PresentationAssetsService) {}

  @Get()
  async listDirectory(
    @Param('presentationId', new ParseUUIDPipe({ version: '4' })) presentationId: string,
    @Req() req: RequestWithUser,
    @Query('path') path?: string,
  ): Promise<FileNodeDto[]> {
    return await this.assetsService.listDirectory(getMarpdownUserFromRequest(req), presentationId, path);
  }

  @Get('*path')
  async readAsset(
    @Param('presentationId', new ParseUUIDPipe({ version: '4' })) presentationId: string,
    @Param('path') rawPath: string | string[] | undefined,
    @Req() req: RequestWithUser,
  ): Promise<AssetContentDto> {
    const path = this.normalizeWildcardPath(rawPath);

    return await this.assetsService.readAsset(getMarpdownUserFromRequest(req), presentationId, path);
  }

  @Put('*path')
  async writeAsset(
    @Param('presentationId', new ParseUUIDPipe({ version: '4' })) presentationId: string,
    @Param('path') rawPath: string | string[] | undefined,
    @Req() req: RequestWithUser,
    @Body() dto: WriteAssetDto,
  ): Promise<void> {
    const path = this.normalizeWildcardPath(rawPath);

    await this.assetsService.writeAsset(getMarpdownUserFromRequest(req), presentationId, path, dto);
  }

  @Post('*path')
  async createAsset(
    @Param('presentationId', new ParseUUIDPipe({ version: '4' })) presentationId: string,
    @Param('path') rawPath: string | string[] | undefined,
    @Req() req: RequestWithUser,
    @Body() dto: CreateAssetDto,
  ): Promise<void> {
    const path = this.normalizeWildcardPath(rawPath);

    await this.assetsService.createAsset(getMarpdownUserFromRequest(req), presentationId, path, dto);
  }

  @Patch('*path')
  async moveAsset(
    @Param('presentationId', new ParseUUIDPipe({ version: '4' })) presentationId: string,
    @Param('path') rawPath: string | string[] | undefined,
    @Req() req: RequestWithUser,
    @Body() dto: MoveAssetDto,
  ): Promise<void> {
    const path = this.normalizeWildcardPath(rawPath);

    await this.assetsService.moveAsset(getMarpdownUserFromRequest(req), presentationId, path, dto);
  }

  @Delete('*path')
  async deleteAsset(
    @Param('presentationId', new ParseUUIDPipe({ version: '4' })) presentationId: string,
    @Param('path') rawPath: string | string[] | undefined,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    const path = this.normalizeWildcardPath(rawPath);

    await this.assetsService.deleteAsset(getMarpdownUserFromRequest(req), presentationId, path);
  }

  private normalizeWildcardPath(path: string | string[] | undefined): string {
    if (typeof path === 'string') {
      return path;
    }

    if (Array.isArray(path)) {
      return path.join('/');
    }

    throw new BadRequestException('Asset path is required');
  }
}
