import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { AuditService, type AuditEntryDto } from '../audit/audit.service';

export class AuditQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
  project?: string;

  /** Exact action or a prefix ending in `*`. */
  @IsOptional()
  @Matches(/^[a-z0-9._-]{1,127}\*?$/)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  actor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  target?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  text?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Matches(/^\d{1,19}$/)
  before?: string;
}

export class AuditExportQueryDto extends AuditQueryDto {
  @IsOptional()
  @IsIn(['csv', 'ndjson'])
  format?: 'csv' | 'ndjson';
}

/** The audit log (3.18): auditors and cluster admins everything, project admins their project. */
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequireScopes('audit:read')
  async list(
    @Query() query: AuditQueryDto,
    @Req() req?: RequestWithUser,
  ): Promise<{ entries: AuditEntryDto[]; before: string | null }> {
    return await this.audit.list(req, query);
  }

  @Get('export')
  @RequireScopes('audit:read')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Content-Disposition', 'attachment')
  async export(@Query() query: AuditExportQueryDto, @Req() req?: RequestWithUser): Promise<string> {
    const { format, ...filter } = query;

    return await this.audit.export(req, filter, format ?? 'ndjson');
  }
}
