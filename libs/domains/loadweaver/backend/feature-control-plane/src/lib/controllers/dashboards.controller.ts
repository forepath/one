import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { z } from 'zod';

import {
  DashboardQueryService,
  dashboardQueryRequestSchema,
  grafanaQuerySchema,
  grafanaRangeSchema,
  type DashboardQueryRequest,
  type DashboardQueryResult,
} from '../dashboards/dashboard-query.service';
import { ZodValidationPipe } from '../utils/zod-validation.pipe';

const grafanaAnnotationsSchema = z.object({ range: grafanaRangeSchema }).passthrough();

/** The dashboard query builder (3.18); dashboards themselves are `Dashboard` resources. */
@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly queries: DashboardQueryService) {}

  /** Runs one widget query within the global filter, scoped like the curated views (metrics / flows / logs). */
  @Post('query')
  @HttpCode(200)
  @RequireScopes('metrics:read')
  async query(
    @Body(new ZodValidationPipe(dashboardQueryRequestSchema)) body: DashboardQueryRequest,
    @Req() req?: RequestWithUser,
  ): Promise<DashboardQueryResult> {
    return await this.queries.run(req, body);
  }
}

/**
 * A Grafana-compatible data source (SimpleJSON / JSON API protocol, 3.18): point Grafana at `/api/grafana` with a
 * PAT (`metrics:read`) as bearer token; it sees what the token's owner may read.
 */
@Controller('grafana')
export class GrafanaController {
  constructor(private readonly queries: DashboardQueryService) {}

  @Get()
  @RequireScopes('metrics:read')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Post('search')
  @HttpCode(200)
  @RequireScopes('metrics:read')
  async search(@Req() req?: RequestWithUser): Promise<string[]> {
    return await this.queries.grafanaSearch(req);
  }

  @Post('query')
  @HttpCode(200)
  @RequireScopes('metrics:read')
  async query(
    @Body(new ZodValidationPipe(grafanaQuerySchema)) body: z.infer<typeof grafanaQuerySchema>,
    @Req() req?: RequestWithUser,
  ) {
    return await this.queries.grafanaQuery(req, body);
  }

  @Post('annotations')
  @HttpCode(200)
  @RequireScopes('metrics:read')
  async annotations(
    @Body(new ZodValidationPipe(grafanaAnnotationsSchema)) body: z.infer<typeof grafanaAnnotationsSchema>,
    @Req() req?: RequestWithUser,
  ) {
    return await this.queries.grafanaAnnotations(req, body.range);
  }
}
