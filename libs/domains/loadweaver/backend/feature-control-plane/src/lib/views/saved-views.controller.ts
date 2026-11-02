import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { SavedViewsService, type SavedViewDto } from './saved-views.service';

/** A list id (`contents`, `audit`, `plans`, `tree`, …) or `settings` for console settings. */
export const VIEW_SCOPE = /^[a-z0-9][a-z0-9:._-]{0,99}$/;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListViewsQueryDto {
  @IsOptional()
  @Matches(VIEW_SCOPE)
  scope?: string;
}

export class CreateViewDto {
  @IsString()
  @Matches(VIEW_SCOPE)
  scope!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /** Opaque console state (max 16 KiB serialized). */
  @IsObject()
  state!: Record<string, unknown>;
}

export class UpdateViewDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsObject()
  state?: Record<string, unknown>;
}

/**
 * Saved views / filters per user, server-side (3.37): only the caller's own views (through a fleet: the verified
 * person's). Scope `cluster:read` like search favourites.
 */
@Controller('views')
export class SavedViewsController {
  constructor(private readonly views: SavedViewsService) {}

  @Get()
  @RequireScopes('cluster:read')
  async list(@Query() q: ListViewsQueryDto, @Req() req?: RequestWithUser): Promise<SavedViewDto[]> {
    return await this.views.list(req, q.scope);
  }

  @Post()
  @RequireScopes('cluster:read')
  async create(@Body() dto: CreateViewDto, @Req() req?: RequestWithUser): Promise<SavedViewDto> {
    return await this.views.create(req, { scope: dto.scope, name: dto.name, state: dto.state });
  }

  @Patch(':id')
  @RequireScopes('cluster:read')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateViewDto,
    @Req() req?: RequestWithUser,
  ): Promise<SavedViewDto> {
    return await this.views.update(req, id, { name: dto.name, state: dto.state });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('cluster:read')
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await this.views.remove(req, id);
  }
}
