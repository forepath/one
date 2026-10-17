import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Controller, Get, Query, Req } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

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
  constructor(private readonly topology: TopologyService) {}

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
}
