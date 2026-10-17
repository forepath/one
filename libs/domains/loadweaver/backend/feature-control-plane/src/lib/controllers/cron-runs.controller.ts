import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { BadRequestException, Controller, Get, Param, Query, Req } from '@nestjs/common';

import type { CronRunEntity } from '../entities/cron-run.entity';
import { ClusterAccessService } from '../services/cluster-access.service';
import { CronControllerService } from '../services/cron-controller.service';
import { NodeNamePipe } from '../utils/name.pipe';

const CRON_JOB = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\/[a-z0-9]([a-z0-9_.-]{0,62})$/;

/** Every cron run with node, timing and exit code (3.23). */
@Controller('projects/:project/cron-runs')
export class CronRunsController {
  constructor(
    private readonly cron: CronControllerService,
    private readonly access: ClusterAccessService,
  ) {}

  @Get()
  @RequireScopes('cluster:read')
  async list(
    @Param('project', NodeNamePipe) project: string,
    @Query('job') job?: string,
    @Query('limit') limit?: string,
    @Req() req?: RequestWithUser,
  ): Promise<CronRunEntity[]> {
    await this.access.assert(req, 'read');

    if (job !== undefined && !CRON_JOB.test(job)) throw new BadRequestException('job must be <deployment>/<service>');

    const take = limit === undefined ? 100 : Number(limit);

    if (!Number.isInteger(take) || take < 1 || take > 500)
      throw new BadRequestException('limit must be between 1 and 500');

    return await this.cron.runs(project, job ? `${project}/${job}` : undefined, take);
  }
}
