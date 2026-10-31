import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, HttpCode, HttpStatus, Logger, Optional, Param, Post, Req } from '@nestjs/common';

import { FleetAccessService } from '../services/fleet-access.service';
import { FleetIdentityService, type FleetIdentityDto } from '../services/fleet-identity.service';
import { FleetTrustService } from '../services/fleet-trust.service';
import type { FleetCaller } from '../utils/fleet-access.utils';

/**
 * The fleet's signing identity (3.24): issuer and Ed25519 public keys the clusters hold under "trusted fleets"
 * (registered by the fleet itself where its credential may, 2026-10-29, else by a cluster admin), and the key
 * rotation: a new or activated key is registered in every cluster right away. Fleet admins only.
 */
@Controller('identity')
export class FleetIdentityController {
  private readonly logger = new Logger(FleetIdentityController.name);

  constructor(
    private readonly access: FleetAccessService,
    private readonly identity: FleetIdentityService,
    @Optional() private readonly trust?: FleetTrustService,
  ) {}

  /** Rotation steps register the keys in the clusters in the background (the answer doesn't wait for them). */
  private syncClusters(caller: FleetCaller): void {
    void this.trust
      ?.syncAll(caller)
      .catch((error: unknown) => this.logger.warn(`Trust sync: ${error instanceof Error ? error.message : error}`));
  }

  @Get()
  @RequireScopes('fleet:admin')
  async get(@Req() req?: RequestWithUser): Promise<FleetIdentityDto> {
    this.access.assertAdmin(this.access.caller(req));

    return await this.identity.describe();
  }

  /** Creates the next key: register it in the clusters, then activate it. */
  @Post('keys')
  @RequireScopes('fleet:admin')
  async createNext(@Req() req?: RequestWithUser): Promise<FleetIdentityDto> {
    const caller = this.access.caller(req);

    this.access.assertAdmin(caller);

    const result = await this.identity.createNext(caller);

    this.syncClusters(caller);

    return result;
  }

  @Post('keys/:kid/activate')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('fleet:admin')
  async activate(@Param('kid') kid: string, @Req() req?: RequestWithUser): Promise<FleetIdentityDto> {
    const caller = this.access.caller(req);

    this.access.assertAdmin(caller);

    const result = await this.identity.activate(caller, kid);

    this.syncClusters(caller);

    return result;
  }
}
