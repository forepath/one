import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { DnsZoneStatusEntity } from '../entities/dns-zone-status.entity';
import { ClusterAccessService } from '../services/cluster-access.service';
import { actorFromRequest } from '../services/audit-log.service';
import { DnsFailoverControllerService } from '../dns/dns-failover-controller.service';
import { DnssecService, type DnssecZoneSummary } from '../dns/dnssec.service';
import type { DnsFailoverStateEntity } from '../entities/dns-failover.entity';
import { NodeNamePipe } from '../utils/name.pipe';

/**
 * State of the managed zones at their providers (3.15): last sync, errors, names owned by someone else, secondary
 * drift, DNSSEC.
 */
@Controller('dns')
export class DnsController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ClusterAccessService,
    private readonly failover: DnsFailoverControllerService,
    private readonly dnssec: DnssecService,
  ) {}

  /** Endpoint health and current answers of every DNS failover (3.28). */
  @Get('failover')
  @RequireScopes('cluster:read')
  async failovers(@Req() req?: RequestWithUser): Promise<DnsFailoverStateEntity[]> {
    await this.access.assert(req, 'read');

    return await this.failover.states();
  }

  /** Confirms a pending manual fail-back to the primary endpoint. */
  @Post('failover/:name/failback')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:nodes')
  async failback(
    @Param('name', NodeNamePipe) name: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ confirmed: true }> {
    await this.access.assert(req, 'infra');

    if (!(await this.failover.confirmFailback(name, actorFromRequest(req))))
      throw new NotFoundException(`no fail-back is pending for ${name}`);

    return { confirmed: true };
  }

  /** DNSSEC per zone (3.15): keys and their DS state at the parent, the DS records to publish, next rollover. */
  @Get('dnssec')
  @RequireScopes('cluster:read')
  async dnssecState(@Req() req?: RequestWithUser): Promise<DnssecZoneSummary[]> {
    await this.access.assert(req, 'read');

    return await this.dnssec.summary();
  }

  @Get('zones')
  @RequireScopes('cluster:read')
  async zones(@Req() req?: RequestWithUser): Promise<DnsZoneStatusEntity[]> {
    await this.access.assert(req, 'read');

    return await this.dataSource.getRepository(DnsZoneStatusEntity).find({ order: { zone: 'ASC', provider: 'ASC' } });
  }
}
