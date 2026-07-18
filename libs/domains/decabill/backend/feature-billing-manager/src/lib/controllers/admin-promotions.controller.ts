import { KeycloakRoles, RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';

import type {
  AdminPromotionResponseDto,
  CreateAdminPromotionDto,
  PaginatedAdminPromotionsResponseDto,
  PaginatedPromotionRedemptionsResponseDto,
  UpdateAdminPromotionDto,
} from '../dto/promotion.dto';
import { PromotionAdminService } from '../services/promotion-admin.service';

@Controller('admin/billing/promotions')
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
@RequireScopes('promotions:write')
export class AdminPromotionsController {
  constructor(private readonly promotionAdminService: PromotionAdminService) {}

  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<PaginatedAdminPromotionsResponseDto> {
    return await this.promotionAdminService.list(limit ?? 10, offset ?? 0);
  }

  @Post()
  async create(@Body() dto: CreateAdminPromotionDto): Promise<AdminPromotionResponseDto> {
    return await this.promotionAdminService.create(dto);
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AdminPromotionResponseDto> {
    return await this.promotionAdminService.get(id);
  }

  @Put(':id')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateAdminPromotionDto,
  ): Promise<AdminPromotionResponseDto> {
    return await this.promotionAdminService.update(id, dto);
  }

  @Delete(':id')
  async deactivate(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AdminPromotionResponseDto> {
    return await this.promotionAdminService.deactivate(id);
  }

  @Get(':id/redemptions')
  async listRedemptions(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<PaginatedPromotionRedemptionsResponseDto> {
    return await this.promotionAdminService.listRedemptions(id, limit ?? 10, offset ?? 0);
  }
}
