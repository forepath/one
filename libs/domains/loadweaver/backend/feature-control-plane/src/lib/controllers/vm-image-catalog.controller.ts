import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import type { VmImageCatalogEntry } from '@forepath/loadweaver/shared/util-model';
import { Controller, Get, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { VmImageCatalogEntriesService } from '../services/vm-image-catalog-entries.service';

/** The live lookup reaches the distros' servers: a few per minute and caller are plenty (it is cached anyway). */
const UPSTREAM_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * VM image catalog (3.42): recommended images for the VM wizard and the project's Images tab. Imports keep
 * `POST /projects/:project/vm-images/import`. Any project membership or cluster role.
 */
@Controller('vm-images/catalog')
export class VmImageCatalogController {
  constructor(private readonly catalog: VmImageCatalogEntriesService) {}

  /** The shipped list and the cluster's own entries (`Cluster.spec.vmImages`). */
  @Get()
  @RequireScopes('resources:read')
  async list(@Req() req?: RequestWithUser): Promise<{ entries: VmImageCatalogEntry[] }> {
    return await this.catalog.catalog(req);
  }

  /** Current builds from the distros' published checksum lists; failed lines are named in `warnings`. */
  @Get('upstream')
  @Throttle(UPSTREAM_THROTTLE)
  @RequireScopes('resources:read')
  async upstream(@Req() req?: RequestWithUser): Promise<{ entries: VmImageCatalogEntry[]; warnings: string[] }> {
    return await this.catalog.upstream(req);
  }
}
