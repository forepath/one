import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';

import { CLOUD_REFERENCE_PATTERN, CloudTeardownDto, RegisterCloudClusterDto } from '../dto/fleet.dto';
import { FleetAccessService } from '../services/fleet-access.service';
import type { FleetClusterDto } from '../services/fleet-clusters.service';
import { FleetCloudService, type CloudClusterStatusDto } from '../services/fleet-cloud.service';

function reference(raw: string): string {
  const value = decodeURIComponent(raw);

  if (!CLOUD_REFERENCE_PATTERN.test(value)) throw new BadRequestException('invalid reference');

  return value;
}

/**
 * Loadweaver Cloud hooks (section 4): registration of Decabill-provisioned clusters and the teardown call Decabill
 * makes before deleting a server (final backup + read-only grace). Fleet admins, or PATs of a fleet admin with the
 * dedicated `cloud:*` scopes (Decabill's credential).
 */
@Controller('cloud/clusters')
export class FleetCloudController {
  constructor(
    private readonly access: FleetAccessService,
    private readonly cloud: FleetCloudService,
  ) {}

  @Post()
  @RequireScopes('cloud:register')
  async register(@Body() dto: RegisterCloudClusterDto, @Req() req?: RequestWithUser): Promise<FleetClusterDto> {
    const caller = this.access.caller(req);

    this.access.assertAdmin(caller);

    return await this.cloud.register(caller, dto);
  }

  @Get(':reference')
  @RequireScopes('cloud:teardown')
  async status(@Param('reference') raw: string, @Req() req?: RequestWithUser): Promise<CloudClusterStatusDto> {
    this.access.assertAdmin(this.access.caller(req));

    return await this.cloud.status(reference(raw));
  }

  @Put(':reference/teardown')
  @RequireScopes('cloud:teardown')
  async teardown(
    @Param('reference') raw: string,
    @Body() dto: CloudTeardownDto,
    @Req() req?: RequestWithUser,
  ): Promise<CloudClusterStatusDto> {
    const caller = this.access.caller(req);

    this.access.assertAdmin(caller);

    return await this.cloud.teardown(caller, reference(raw), dto);
  }

  @Delete(':reference/teardown')
  @RequireScopes('cloud:teardown')
  async cancelTeardown(@Param('reference') raw: string, @Req() req?: RequestWithUser): Promise<CloudClusterStatusDto> {
    const caller = this.access.caller(req);

    this.access.assertAdmin(caller);

    return await this.cloud.cancelTeardown(caller, reference(raw));
  }
}
