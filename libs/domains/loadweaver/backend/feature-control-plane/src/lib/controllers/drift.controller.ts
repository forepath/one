import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Matches } from 'class-validator';

import type { PlanResponseDto } from '../dto/plan.dto';
import { DriftService, type DriftReport } from '../plans/drift.service';

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export class ProposeDriftPlanDto {
  @Matches(NAME)
  node!: string;

  @Matches(/^[0-9a-f]{12,64}$/)
  container!: string;

  @Matches(NAME)
  project!: string;

  @Matches(NAME)
  deployment!: string;
}

/** Drift (3.8): foreign containers and inconsistent states, and plans proposed from them. */
@Controller('drift')
export class DriftController {
  constructor(private readonly drift: DriftService) {}

  @Get()
  @RequireScopes('cluster:read')
  async report(@Req() req?: RequestWithUser): Promise<DriftReport> {
    return await this.drift.report(req);
  }

  @Post('plans')
  @RequireScopes('plans:create')
  async propose(@Body() dto: ProposeDriftPlanDto, @Req() req?: RequestWithUser): Promise<PlanResponseDto> {
    return await this.drift.propose(req, dto);
  }
}
