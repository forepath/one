import { basename } from 'node:path';

import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { BackupsService } from './backups.service';

export class KitSizeDto {
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(16)
  shares!: number;

  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(16)
  threshold!: number;
}

export class RotateKeyDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(16)
  shares?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(16)
  threshold?: number;
}

export class ConfirmKitDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @IsString({ each: true })
  @MaxLength(8192, { each: true })
  shares!: string[];
}

export class DeletionRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  backupIds!: string[];

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class BackupNowDto {
  @IsString()
  @Matches(/^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}$/)
  volume!: string;
}

const PROJECT = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const VOLUME = /^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}$/;

function optional(value: string | undefined, pattern: RegExp, name: string): string | undefined {
  if (value !== undefined && !pattern.test(value)) throw new BadRequestException(`invalid ${name}`);

  return value;
}

/**
 * Backups (3.20): catalog / timeline / diff / file browsing, restore tests, deletion requests (second admin +
 * delay), the backup key and recovery kit. Restores are `Restore` resources created through plans.
 */
@Controller('backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get('status')
  @RequireScopes('projects:read')
  async status(@Req() req?: RequestWithUser) {
    return await this.backups.status(req);
  }

  @Get()
  @RequireScopes('projects:read')
  async catalog(
    @Query('project') project?: string,
    @Query('resource') resource?: string,
    @Query('includeDeleted') includeDeleted?: string,
    @Query('limit') limit?: string,
    @Req() req?: RequestWithUser,
  ) {
    const take = limit === undefined ? undefined : Number(limit);

    if (take !== undefined && (!Number.isInteger(take) || take < 1 || take > 2000))
      throw new BadRequestException('limit must be between 1 and 2000');

    return await this.backups.catalog(req, {
      project: optional(project, PROJECT, 'project'),
      resource: optional(resource, VOLUME, 'resource'),
      includeDeleted: includeDeleted === 'true',
      limit: take,
    });
  }

  @Get('restore-tests')
  @RequireScopes('projects:read')
  async restoreTests(
    @Query('project') project?: string,
    @Query('resource') resource?: string,
    @Req() req?: RequestWithUser,
  ) {
    return await this.backups.restoreTests(req, {
      project: optional(project, PROJECT, 'project'),
      resource: optional(resource, VOLUME, 'resource'),
    });
  }

  @Get('restores')
  @RequireScopes('projects:read')
  async restores(@Query('project') project?: string, @Req() req?: RequestWithUser) {
    return await this.backups.restores(req, optional(project, PROJECT, 'project'));
  }

  @Get('diff')
  @RequireScopes('projects:read')
  async diff(
    @Query('from', new ParseUUIDPipe()) from: string,
    @Query('to', new ParseUUIDPipe()) to: string,
    @Req() req?: RequestWithUser,
  ) {
    return await this.backups.diff(req, from, to);
  }

  @Post('now')
  @RequireScopes('plans:apply')
  async backupNow(@Body() dto: BackupNowDto, @Req() req?: RequestWithUser) {
    return await this.backups.backupNow(req, dto.volume);
  }

  @Get('deletions')
  @RequireScopes('projects:read')
  async deletions(@Req() req?: RequestWithUser) {
    return await this.backups.deletions(req);
  }

  @Post('deletions')
  @RequireScopes('projects:admin')
  async requestDeletion(@Body() dto: DeletionRequestDto, @Req() req?: RequestWithUser) {
    return await this.backups.requestDeletion(req, dto);
  }

  @Post('deletions/:id/approve')
  @RequireScopes('projects:admin')
  async approveDeletion(@Param('id', new ParseUUIDPipe()) id: string, @Req() req?: RequestWithUser) {
    return await this.backups.approveDeletion(req, id);
  }

  @Post('deletions/:id/cancel')
  @RequireScopes('projects:admin')
  async cancelDeletion(@Param('id', new ParseUUIDPipe()) id: string, @Req() req?: RequestWithUser) {
    return await this.backups.cancelDeletion(req, id);
  }

  @Get('keys')
  @RequireScopes('cluster:admin')
  async keys(@Req() req?: RequestWithUser) {
    return await this.backups.keyGenerations(req);
  }

  @Post('keys/rotate')
  @RequireScopes('cluster:admin')
  async rotate(@Body() dto: RotateKeyDto, @Req() req?: RequestWithUser) {
    if ((dto.shares === undefined) !== (dto.threshold === undefined))
      throw new BadRequestException('give both shares and threshold, or neither');

    return await this.backups.rotateKey(
      req,
      dto.shares !== undefined && dto.threshold !== undefined
        ? { shares: dto.shares, threshold: dto.threshold }
        : undefined,
    );
  }

  // The kit (shares, also through a fleet since 2026-10-30) never lands in a cache.
  @Post('keys/:generation/kit')
  @RequireScopes('cluster:admin')
  @Header('Cache-Control', 'no-store')
  async reissueKit(
    @Param('generation', ParseIntPipe) generation: number,
    @Body() dto: KitSizeDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.backups.reissueKit(req, generation, dto);
  }

  /** Each share is handed out exactly once (POST: it changes state). */
  @Post('keys/:generation/kit/shares/:index')
  @RequireScopes('cluster:admin')
  @Header('Cache-Control', 'no-store')
  async downloadShare(
    @Param('generation', ParseIntPipe) generation: number,
    @Param('index', ParseIntPipe) index: number,
    @Req() req?: RequestWithUser,
  ) {
    return await this.backups.downloadShare(req, generation, index);
  }

  @Post('keys/:generation/kit/confirm')
  @RequireScopes('cluster:admin')
  @Header('Cache-Control', 'no-store')
  async confirmKit(
    @Param('generation', ParseIntPipe) generation: number,
    @Body() dto: ConfirmKitDto,
    @Req() req?: RequestWithUser,
  ): Promise<{ confirmed: true }> {
    await this.backups.confirmKit(req, generation, dto.shares);

    return { confirmed: true };
  }

  @Post('keys/:generation/escrow')
  @RequireScopes('cluster:admin')
  async escrow(@Param('generation', ParseIntPipe) generation: number, @Req() req?: RequestWithUser) {
    return await this.backups.escrowKey(req, generation);
  }

  @Get(':id')
  @RequireScopes('projects:read')
  async get(@Param('id', new ParseUUIDPipe()) id: string, @Req() req?: RequestWithUser) {
    return await this.backups.get(req, id);
  }

  @Get(':id/files')
  @RequireScopes('projects:read')
  async files(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('path') path?: string,
    @Req() req?: RequestWithUser,
  ) {
    if (path !== undefined && path.length > 4096) throw new BadRequestException('path too long');

    return await this.backups.files(req, id, path);
  }

  @Get(':id/download')
  @RequireScopes('projects:read')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('path') path: string,
    @Req() req?: RequestWithUser,
  ): Promise<StreamableFile> {
    if (!path || path.length > 4096) throw new BadRequestException('path is required');

    const stream = await this.backups.download(req, id, path);

    return new StreamableFile(stream, {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${basename(path).replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    });
  }

  @Post(':id/restore-test')
  @RequireScopes('plans:apply')
  async restoreTest(@Param('id', new ParseUUIDPipe()) id: string, @Req() req?: RequestWithUser) {
    return await this.backups.testNow(req, id);
  }
}
