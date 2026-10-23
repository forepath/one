import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, Query, Req } from '@nestjs/common';
import { IsOptional, Matches } from 'class-validator';

import { AutoscalerService, type AutoscalingDto } from './autoscaler.service';

export class AutoscalingQueryDto {
  @IsOptional()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
  project?: string;
}

/** Autoscaling status (3.23): per autoscaled service its range, metric vs. target, last scaling and blocked reason. */
@Controller('autoscaling')
export class AutoscalingController {
  constructor(private readonly autoscaler: AutoscalerService) {}

  @Get()
  @RequireScopes('projects:read')
  async list(@Query() q: AutoscalingQueryDto, @Req() req?: RequestWithUser): Promise<AutoscalingDto[]> {
    return await this.autoscaler.list(req, q.project);
  }
}
