import { Public, RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import type { KioskSection } from '../health/overview.service';
import { WallboardService, type WallboardTokenDto } from '../health/wallboard.service';

export class CreateWallboardTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  /** Projects shown (project admins); none: the whole cluster (cluster admins). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, { each: true })
  projects?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}

/** Wallboard tokens (3.25): read-only tokens that can only open the kiosk view. */
@Controller('wallboards')
export class WallboardsController {
  constructor(private readonly wallboards: WallboardService) {}

  @Post()
  @RequireScopes('projects:admin')
  async create(
    @Body() dto: CreateWallboardTokenDto,
    @Req() req?: RequestWithUser,
  ): Promise<WallboardTokenDto & { token: string }> {
    return await this.wallboards.create(req, dto);
  }

  @Get()
  @RequireScopes('projects:admin')
  async list(@Req() req?: RequestWithUser): Promise<WallboardTokenDto[]> {
    return await this.wallboards.list(req);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireScopes('projects:admin')
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser): Promise<void> {
    await this.wallboards.revoke(req, id);
  }
}

/**
 * The kiosk view's data (3.25), for a wallboard token in `Authorization: Wallboard <token>` only — the console keeps
 * the token in the URL fragment, which never reaches the server or its logs.
 */
@Public()
@Controller('public/wallboard')
export class PublicWallboardController {
  constructor(private readonly wallboards: WallboardService) {}

  @Get()
  async kiosk(@Headers('authorization') authorization?: string): Promise<{ name: string; sections: KioskSection[] }> {
    return await this.wallboards.kiosk(authorization);
  }
}
