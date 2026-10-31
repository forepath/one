import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';

import { ReportsService, type FileEntry, type ReportDto } from '../reports/reports.service';

export class RunReportDto {
  /** `cluster` or a project. */
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
  scope!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}

export class FilePathQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  path?: string;
}

function attachment(res: Response, name: string, type: string): void {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

/** Periodic reports (3.25) and their file tree (Decabill's file explorer pattern). */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequireScopes('cluster:read')
  async list(@Req() req?: RequestWithUser): Promise<ReportDto[]> {
    return await this.reports.list(req);
  }

  /** Queues a report for a finished month (cluster admins for `cluster`, project admins for their project). */
  @Post('run')
  @HttpCode(202)
  @RequireScopes('projects:admin')
  async run(@Body() dto: RunReportDto, @Req() req?: RequestWithUser): Promise<void> {
    await this.reports.request(req, dto);
  }

  @Get('files')
  @RequireScopes('cluster:read')
  async tree(@Query() q: FilePathQueryDto, @Req() req?: RequestWithUser): Promise<FileEntry[]> {
    return await this.reports.tree(req, q.path ?? '');
  }

  @Get('files/download')
  @RequireScopes('cluster:read')
  async download(
    @Query() q: FilePathQueryDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: RequestWithUser,
  ): Promise<StreamableFile> {
    const file = await this.reports.download(req, q.path ?? '');

    // Downloaded, never rendered in the console's origin.
    attachment(res, file.name, 'application/octet-stream');

    return new StreamableFile(file.content);
  }

  @Get('files/archive')
  @RequireScopes('cluster:read')
  async archive(
    @Query() q: FilePathQueryDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: RequestWithUser,
  ): Promise<StreamableFile> {
    const file = await this.reports.archive(req, q.path ?? '');

    attachment(res, file.name, 'application/zip');

    return new StreamableFile(file.content);
  }
}
