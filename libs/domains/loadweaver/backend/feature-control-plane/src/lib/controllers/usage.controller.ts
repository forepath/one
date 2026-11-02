import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

import { USAGE_GRANULARITIES, USAGE_METERS, type UsageGranularity, type UsageMeter } from '../usage/usage.constants';
import { UsageService } from '../usage/usage.service';
import { usageCsv, type UsageReport } from '../usage/usage.utils';
import { NodeNamePipe } from '../utils/name.pipe';

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export class UsageQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsIn(USAGE_GRANULARITIES)
  granularity?: UsageGranularity;

  @IsOptional()
  @IsIn(USAGE_METERS)
  meter?: UsageMeter;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  finalOnly?: boolean;
}

export class ClusterUsageQueryDto extends UsageQueryDto {
  @IsOptional()
  @Matches(NAME)
  project?: string;

  /** Decabill subscription id a project is mapped to (`spec.billing.decabillSubscriptionId`). */
  @IsOptional()
  @IsUUID()
  billingSubscription?: string;
}

/**
 * Usage metering (3.24): hourly buckets per project for CPU, memory, storage, traffic and public addresses, by hour,
 * day or month, as JSON or CSV. Project readers see their projects; cluster roles see all projects (Decabill's
 * collector reads `GET /usage?billingSubscription=…&granularity=hour&finalOnly=true` with an auditor's PAT).
 */
@Controller()
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get('usage')
  @RequireScopes('usage:read')
  async cluster(@Query() dto: ClusterUsageQueryDto, @Req() req?: RequestWithUser): Promise<UsageReport> {
    return await this.usage.forCluster(req, dto);
  }

  @Get('usage/export')
  @RequireScopes('usage:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async clusterExport(@Query() dto: ClusterUsageQueryDto, @Req() req?: RequestWithUser): Promise<string> {
    return usageCsv(await this.usage.forCluster(req, dto));
  }

  @Get('projects/:project/usage')
  @RequireScopes('usage:read')
  async project(
    @Param('project', NodeNamePipe) project: string,
    @Query() dto: UsageQueryDto,
    @Req() req?: RequestWithUser,
  ): Promise<UsageReport> {
    return await this.usage.forProject(req, project, dto);
  }

  @Get('projects/:project/usage/export')
  @RequireScopes('usage:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async projectExport(
    @Param('project', NodeNamePipe) project: string,
    @Query() dto: UsageQueryDto,
    @Req() req?: RequestWithUser,
  ): Promise<string> {
    return usageCsv(await this.usage.forProject(req, project, dto));
  }
}
