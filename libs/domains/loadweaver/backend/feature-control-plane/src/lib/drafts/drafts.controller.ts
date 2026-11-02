import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import type { PlanResponseDto } from '../dto/plan.dto';
import type { DraftStatus } from './draft.entity';
import { DraftsService, type DraftOpInput, type DraftPreviewDto } from './drafts.service';
import { MAX_DRAFT_DOCUMENT_BYTES, MAX_DRAFT_OPS, parseIfMatch, type DraftResponseDto } from './drafts.utils';

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export class DraftOpDto implements DraftOpInput {
  @IsIn(['upsert', 'delete'])
  op!: 'upsert' | 'delete';

  /** The resource as one YAML document (upserts). */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DRAFT_DOCUMENT_BYTES)
  document?: string;

  /** The resource to delete (deletes). */
  @IsOptional()
  @Matches(/^[A-Za-z]{1,64}$/)
  kind?: string;

  @IsOptional()
  @Matches(NAME)
  name?: string;

  @IsOptional()
  @Matches(NAME)
  project?: string;

  /** The generation the client edited (default: the resource's current one). */
  @IsOptional()
  @IsInt()
  @Min(0)
  baseGeneration?: number;
}

export class CreateDraftDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DRAFT_OPS)
  @ValidateNested({ each: true })
  @Type(() => DraftOpDto)
  ops?: DraftOpDto[];
}

export class PatchDraftDto {
  /** Alternative to `If-Match`. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999_999_999)
  version?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DRAFT_OPS)
  @ValidateNested({ each: true })
  @Type(() => DraftOpDto)
  set?: DraftOpDto[];

  /** Op keys `Kind/project/name` (empty project for cluster-level kinds). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DRAFT_OPS)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  remove?: string[];
}

export class DraftVersionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999_999_999)
  version?: number;
}

export class ListDraftsQueryDto {
  @IsOptional()
  @IsIn(['open', 'submitted', 'discarded'])
  status?: DraftStatus;
}

/** The version a write is based on: `If-Match` or `version` in the body (428-style 400 when neither is given). */
function versionOf(ifMatch: string | undefined, body: { version?: number } | undefined): number {
  const version = parseIfMatch(ifMatch) ?? body?.version;

  if (!version) throw new BadRequestException('the draft version is required (If-Match or version)');

  return version;
}

/**
 * Workspace drafts (3.36): shared, server-side drafts of resource changes → dry-run preview → plan. Read with
 * `resources:read`, write with `plans:create` (like planning); visibility / editing per the draft's touched projects.
 */
@Controller('drafts')
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  @Post()
  @RequireScopes('plans:create')
  async create(@Body() dto: CreateDraftDto, @Req() req?: RequestWithUser): Promise<DraftResponseDto> {
    return await this.drafts.create(req, { title: dto.title, ops: dto.ops });
  }

  @Get()
  @RequireScopes('resources:read')
  async list(@Query() q: ListDraftsQueryDto, @Req() req?: RequestWithUser): Promise<DraftResponseDto[]> {
    return await this.drafts.list(req, q.status ?? 'open');
  }

  @Get(':id')
  @RequireScopes('resources:read')
  async get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<DraftResponseDto> {
    return await this.drafts.get(req, id);
  }

  @Patch(':id')
  @RequireScopes('plans:create')
  async patch(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: PatchDraftDto,
    @Headers('if-match') ifMatch?: string,
    @Req() req?: RequestWithUser,
  ): Promise<DraftResponseDto> {
    return await this.drafts.patch(req, id, {
      version: versionOf(ifMatch, dto),
      title: dto.title,
      set: dto.set,
      remove: dto.remove,
    });
  }

  @Post(':id/preview')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('plans:create')
  async preview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<DraftPreviewDto> {
    return await this.drafts.preview(req, id);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('plans:create')
  async submit(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: DraftVersionDto,
    @Headers('if-match') ifMatch?: string,
    @Req() req?: RequestWithUser,
  ): Promise<PlanResponseDto> {
    return await this.drafts.submit(req, id, versionOf(ifMatch, dto));
  }

  @Post(':id/discard')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('plans:create')
  async discard(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: DraftVersionDto,
    @Headers('if-match') ifMatch?: string,
    @Req() req?: RequestWithUser,
  ): Promise<DraftResponseDto> {
    return await this.drafts.discard(req, id, versionOf(ifMatch, dto));
  }
}
