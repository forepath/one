import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { ApplyPlanDto, CreatePlanDto, type PlanResponseDto } from '../dto/plan.dto';
import { PlansService } from '../services/plans.service';

/**
 * Plan → apply for declarative resources (P3, 3.8).
 */
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Post()
  @RequireScopes('plans:create')
  async create(@Body() dto: CreatePlanDto, @Req() req?: RequestWithUser): Promise<PlanResponseDto> {
    return await this.plans.create(dto, req);
  }

  @Get()
  @RequireScopes('resources:read')
  async list(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Req() req?: RequestWithUser,
  ): Promise<PlanResponseDto[]> {
    return await this.plans.list(req, limit);
  }

  @Get(':id')
  @RequireScopes('resources:read')
  async get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<PlanResponseDto> {
    return await this.plans.get(id, req);
  }

  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('plans:apply')
  async apply(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ApplyPlanDto,
    @Req() req?: RequestWithUser,
  ): Promise<PlanResponseDto> {
    return await this.plans.apply(id, req, { confirm: dto?.confirm === true });
  }

  @Post(':id/discard')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('plans:create')
  async discard(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<PlanResponseDto> {
    return await this.plans.discard(id, req);
  }
}
