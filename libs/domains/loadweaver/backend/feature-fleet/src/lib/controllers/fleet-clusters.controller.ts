import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';

import { CreateClusterDto, PutGrantDto, TestClusterDto, UpdateClusterDto } from '../dto/fleet.dto';
import type { FleetClusterHealth } from '../entities/fleet-cluster.entity';
import { FleetAccessService } from '../services/fleet-access.service';
import {
  FleetClustersService,
  toClusterDto,
  type FleetClusterDto,
  type FleetGrantDto,
} from '../services/fleet-clusters.service';
import { FleetOverviewService } from '../services/fleet-overview.service';

/** Cluster connections and per-cluster grants (3.24). Changing them is for fleet admins. */
@Controller('clusters')
export class FleetClustersController {
  constructor(
    private readonly access: FleetAccessService,
    private readonly clusters: FleetClustersService,
    private readonly overview: FleetOverviewService,
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
    const { cluster, access } = await this.access.visibleCluster(this.access.caller(req), id);

    return toClusterDto(cluster, access);
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
