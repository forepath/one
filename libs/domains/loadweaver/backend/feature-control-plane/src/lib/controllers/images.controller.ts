import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, Req } from '@nestjs/common';

import type { ImageScanEntity } from '../entities/image-scan.entity';
import { ImagePolicyService } from '../images/image-policy.service';
import { ClusterAccessService } from '../services/cluster-access.service';

/** Vulnerability scans of the images the cluster runs (3.22), as the nodes reported them. */
@Controller('images')
export class ImagesController {
  constructor(
    private readonly policies: ImagePolicyService,
    private readonly access: ClusterAccessService,
  ) {}

  @Get('scans')
  @RequireScopes('cluster:read')
  async scans(@Req() req?: RequestWithUser): Promise<ImageScanEntity[]> {
    await this.access.assert(req, 'read');

    return await this.policies.scans();
  }
}
