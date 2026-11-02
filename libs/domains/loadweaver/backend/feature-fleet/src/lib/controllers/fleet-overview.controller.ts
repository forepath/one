import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, Query, Req } from '@nestjs/common';

import { CompareQueryDto } from '../dto/fleet.dto';
import { FleetAccessService } from '../services/fleet-access.service';
import { FleetOverviewService } from '../services/fleet-overview.service';
import type { FleetCard, FleetComparison, FleetInboxItem, FleetSite } from '../utils/fleet-aggregation.utils';

/** Fleet overview (3.25): cards, merged inbox, world map, comparison. */
@Controller('fleet')
export class FleetOverviewController {
  constructor(
    private readonly access: FleetAccessService,
    private readonly overview: FleetOverviewService,
  ) {}

  @Get('cards')
  @RequireScopes('fleet:read')
  async cards(@Req() req?: RequestWithUser): Promise<FleetCard[]> {
    return await this.overview.cards(this.access.caller(req));
  }

  @Get('inbox')
  @RequireScopes('fleet:read')
  async inbox(@Req() req?: RequestWithUser): Promise<FleetInboxItem[]> {
    return await this.overview.inbox(this.access.caller(req));
  }

  @Get('sites')
  @RequireScopes('fleet:read')
  async sites(@Req() req?: RequestWithUser): Promise<{ sites: FleetSite[]; withoutLocation: number }> {
    return await this.overview.sites(this.access.caller(req));
  }

  @Get('compare')
  @RequireScopes('fleet:read')
  async compare(@Query() query: CompareQueryDto, @Req() req?: RequestWithUser): Promise<FleetComparison> {
    return await this.overview.compare(
      this.access.caller(req),
      query.clusters
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
}
