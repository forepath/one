import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, Query, Req } from '@nestjs/common';
import { IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { HealthService, type HealthEntityDto } from '../health/health.service';
import { OverviewService, type OverviewDto } from '../health/overview.service';
import { SloService, type SloDto } from '../health/slo.service';

const PROJECT = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export class HealthQueryDto {
  @IsOptional()
  @Matches(PROJECT)
  project?: string;

  /** An entity key (`cluster`, `site/fra1`, `project/shop`, `deployment/shop/store`, ...): it and its descendants. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  root?: string;
}

export class HealthHistoryQueryDto {
  @IsString()
  @MaxLength(300)
  key!: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class OverviewQueryDto {
  @IsOptional()
  @Matches(PROJECT)
  project?: string;
}

/** The overview and the explained health tree (3.25). */
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly overviews: OverviewService,
    private readonly slos: SloService,
  ) {}

  /** SLOs of exposed services with error budget and burn rate (3.25). */
  @Get('slos')
  @RequireScopes('metrics:read')
  async listSlos(@Query() q: OverviewQueryDto, @Req() req?: RequestWithUser): Promise<SloDto[]> {
    return await this.slos.list(req, q.project);
  }

  @Get('overview')
  @RequireScopes('cluster:read')
  async overview(@Query() q: OverviewQueryDto, @Req() req?: RequestWithUser): Promise<OverviewDto> {
    return await this.overviews.overview(req, q.project);
  }

  /** `/health` itself is the liveness check. */
  @Get('health/tree')
  @RequireScopes('cluster:read')
  async tree(@Query() q: HealthQueryDto, @Req() req?: RequestWithUser): Promise<HealthEntityDto[]> {
    return await this.health.tree(req, q);
  }

  @Get('health/history')
  @RequireScopes('cluster:read')
  async history(@Query() q: HealthHistoryQueryDto, @Req() req?: RequestWithUser) {
    return await this.health.history(req, q.key, q);
  }
}
