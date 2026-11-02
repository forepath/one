import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { LOG_SOURCES, type LogSource } from '@forepath/loadweaver/shared/util-model';
import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { LogsService, MAX_QUERY_LINES, type LogLine } from '../logs/logs.service';

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const list = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').filter(Boolean) : undefined;

export class LogQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Transform(list)
  @IsArray()
  @IsIn(LOG_SOURCES, { each: true })
  sources?: LogSource[];

  @IsOptional()
  @Transform(list)
  @IsArray()
  @IsIn(['debug', 'info', 'warn', 'error'], { each: true })
  levels?: ('debug' | 'info' | 'warn' | 'error')[];

  @IsOptional()
  @Matches(NAME)
  project?: string;

  @IsOptional()
  @Matches(NAME)
  deployment?: string;

  @IsOptional()
  @Matches(/^[a-z0-9_.-]{1,63}$/)
  service?: string;

  @IsOptional()
  @Matches(/^[a-z0-9-]+\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/\d{1,9}$/)
  replica?: string;

  @IsOptional()
  @Matches(NAME)
  node?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  policy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  text?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(MAX_QUERY_LINES)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class LogExportDto extends LogQueryDto {
  @IsOptional()
  @IsIn(['ndjson', 'csv'])
  format?: 'ndjson' | 'csv';
}

/** Logs (3.14): query by time range, labels and full text, page by cursor, export; scoped by access. */
@Controller('logs')
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Get()
  @RequireScopes('logs:read')
  async query(
    @Query() dto: LogQueryDto,
    @Req() req?: RequestWithUser,
  ): Promise<{ lines: LogLine[]; cursor: string | null; after: string | null }> {
    return await this.logs.query(req, dto);
  }

  @Get('export')
  @RequireScopes('logs:read')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Content-Disposition', 'attachment')
  async export(@Query() dto: LogExportDto, @Req() req?: RequestWithUser): Promise<string> {
    const { format, ...filter } = dto;

    return await this.logs.export(req, filter, format ?? 'ndjson');
  }
}
