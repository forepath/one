import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Optional,
  Req,
} from '@nestjs/common';

import { CreateClusterDto, EstablishTrustDto, PutGrantDto, TestClusterDto, UpdateClusterDto } from '../dto/fleet.dto';
import type { FleetClusterHealth, FleetTrustAttempt } from '../entities/fleet-cluster.entity';
import { FleetAccessService } from '../services/fleet-access.service';
import {
  FleetClustersService,
  toClusterDto,
  type FleetClusterDto,
  type FleetGrantDto,
} from '../services/fleet-clusters.service';
import { FleetIdentityService } from '../services/fleet-identity.service';
import { FleetOverviewService } from '../services/fleet-overview.service';
import { FleetTrustService } from '../services/fleet-trust.service';

/** Cluster connections and per-cluster grants (3.24). Changing them is for fleet admins. */
@Controller('clusters')
export class FleetClustersController {
  constructor(
    private readonly access: FleetAccessService,
    private readonly clusters: FleetClustersService,
    private readonly overview: FleetOverviewService,
    @Optional() private readonly identity?: FleetIdentityService,
    @Optional() private readonly trust?: FleetTrustService,
  ) {}

  @Get()
  @RequireScopes('fleet:read')
  async list(@Req() req?: RequestWithUser): Promise<FleetClusterDto[]> {
    const caller = this.access.caller(req);

    return (await this.access.visibleClusters(caller)).map(({ cluster, access }) => toClusterDto(cluster, access));
  }

  @Post()
  @RequireScopes('fleet:admin')
  async create(@Body() dto: CreateClusterDto, @Req() req?: RequestWithUser): Promise<FleetClusterDto> {
    const caller = this.access.caller(req);

    this.access.assertAdmin(caller);

    const cluster = await this.clusters.create(caller, dto);

    return toClusterDto(cluster, await this.access.accessFor(caller, cluster));
  }

  /** Tests an endpoint + credential without saving anything. */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('fleet:admin')
  async test(@Body() dto: TestClusterDto, @Req() req?: RequestWithUser): Promise<FleetClusterHealth> {
    this.access.assertAdmin(this.access.caller(req));

    return await this.clusters.test(dto);
  }

  @Get(':id')
  @RequireScopes('fleet:read')
  async get(@Param('id', new ParseUUIDPipe()) id: string, @Req() req?: RequestWithUser): Promise<FleetClusterDto> {
    const caller = this.access.caller(req);
    const { cluster, access } = await this.access.visibleCluster(caller, id);

    // The caller's acting person at the cluster (approvals through the fleet, 3.24).
    return toClusterDto(cluster, access, (await this.identity?.personFor(caller)) ?? null);
  }

  @Patch(':id')
  @RequireScopes('fleet:admin')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateClusterDto,
    @Req() req?: RequestWithUser,
  ): Promise<FleetClusterDto> {
    const caller = this.access.caller(req);

    this.access.assertAdmin(caller);

    const cluster = await this.clusters.update(caller, id, dto);

    this.overview.invalidate(id);

    return toClusterDto(cluster, await this.access.accessFor(caller, cluster));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('fleet:admin')
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req?: RequestWithUser): Promise<void> {
    const caller = this.access.caller(req);

    this.access.assertAdmin(caller);
    await this.clusters.remove(caller, id);
    this.overview.invalidate(id);
  }

  /**
   * Establish trust with the cluster now (2026-10-29, fleet admins): registers this fleet's own keys in the
   * cluster's trusted fleets through the cluster's API — with the connection's credential, or with a cluster admin's
   * one-time token (used for this call only). The cluster's authorisation decides; idempotent; audited on both sides.
   */
  @Post(':id/trust')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('fleet:admin')
  async establishTrust(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EstablishTrustDto,
    @Req() req?: RequestWithUser,
  ): Promise<{ attempt: FleetTrustAttempt; cluster: FleetClusterDto }> {
    const caller = this.access.caller(req);

    this.access.assertAdmin(caller);

    if (!this.trust) throw new NotFoundException('trust is not available');

    const cluster = await this.clusters.get(id);
    const { attempt } = await this.trust.establish(cluster, caller, { adminToken: dto.adminToken });

    return {
      attempt,
      cluster: toClusterDto(
        cluster,
        await this.access.accessFor(caller, cluster),
        (await this.identity?.personFor(caller)) ?? null,
      ),
    };
  }

  /** Health poll now (otherwise every minute). */
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('fleet:read')
  async poll(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<FleetClusterHealth | null> {
    await this.access.visibleCluster(this.access.caller(req), id);

    return await this.clusters.poll(id);
  }

  @Get(':id/grants')
  @RequireScopes('fleet:admin')
  async grants(@Param('id', new ParseUUIDPipe()) id: string, @Req() req?: RequestWithUser): Promise<FleetGrantDto[]> {
    this.access.assertAdmin(this.access.caller(req));

    return await this.clusters.listGrants(id);
  }

  /** Creates or changes the grant of a user (per cluster, optionally per project). */
  @Put(':id/grants')
  @RequireScopes('fleet:admin')
  async putGrant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PutGrantDto,
    @Req() req?: RequestWithUser,
  ): Promise<FleetGrantDto> {
    const caller = this.access.caller(req);

    this.access.assertAdmin(caller);

    return await this.clusters.putGrant(caller, id, dto);
  }

  @Delete(':id/grants/:grantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('fleet:admin')
  async removeGrant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    const caller = this.access.caller(req);

    this.access.assertAdmin(caller);
    await this.clusters.removeGrant(caller, id, grantId);
  }
}
