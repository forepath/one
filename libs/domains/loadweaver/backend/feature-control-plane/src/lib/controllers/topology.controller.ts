import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

import { CreatePlanDto, type PlanResponseDto } from '../dto/plan.dto';
import { PlansService } from '../services/plans.service';
import { TopologyService, type TopologyResponse } from '../topology/topology.service';

export class TopologyQueryDto {
  @IsOptional()
  @IsISO8601()
  at?: string;

  @IsOptional()
  @IsUUID()
  plan?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  flows?: boolean;
}

export class TraceQueryDto {
  @IsString()
  @MaxLength(253)
  @Matches(/^[A-Za-z0-9.-]+$/)
  host!: string;
}

/** The topology map (3.9): structure, flows (live / timeline), plan overlay, path trace. */
@Controller('topology')
export class TopologyController {
  constructor(
    private readonly topology: TopologyService,
    private readonly plans: PlansService,
  ) {}

  @Get()
  @RequireScopes('cluster:read')
  async graph(@Query() q: TopologyQueryDto, @Req() req?: RequestWithUser): Promise<TopologyResponse> {
    return await this.topology.topology(req, q);
  }

  @Get('trace')
  @RequireScopes('cluster:read')
  async trace(@Query() q: TraceQueryDto, @Req() req?: RequestWithUser) {
    return await this.topology.trace(req, q.host);
  }

  /**
   * The map with a dry-run plan's overlay (3.36 B2): same body as `POST /plans`, nothing is stored; returns the map,
   * the overlay and the plan preview (diff, workload changes, failure analysis, risk, warnings).
   */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('plans:create')
  async preview(
    @Body() dto: CreatePlanDto,
    @Req() req?: RequestWithUser,
  ): Promise<TopologyResponse & { plan: PlanResponseDto }> {
    const plan = await this.plans.create({ ...dto, dryRun: true }, req);

    return { ...(await this.topology.topology(req, {}, plan.changes)), plan };
  }
}
