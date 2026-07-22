import { KeycloakRoles, RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import type {
  AdminCustomerProfileDetailDto,
  CreateAdminCustomerProfileDto,
  PaginatedAdminCustomerProfilesResponseDto,
} from '../dto/admin-customer-profile.dto';
import { CustomerProfileDto } from '../dto/customer-profile.dto';
import type { CustomerProfileResponseDto } from '../dto/customer-profile-response.dto';
import type { CustomerTrustScoreResponseDto } from '../dto/customer-trust-score.dto';
import { CustomerProfilesAdminService } from '../services/customer-profiles-admin.service';

@Controller('admin/billing/customer-profiles')
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
@RequireScopes('customer_profile:admin')
export class AdminCustomerProfilesController {
  constructor(private readonly customerProfilesAdminService: CustomerProfilesAdminService) {}

  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<PaginatedAdminCustomerProfilesResponseDto> {
    return await this.customerProfilesAdminService.list(limit ?? 10, offset ?? 0);
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AdminCustomerProfileDetailDto> {
    return await this.customerProfilesAdminService.getById(id);
  }

  @Get(':id/trust-score')
  async getTrustScore(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<CustomerTrustScoreResponseDto> {
    return await this.customerProfilesAdminService.getTrustScore(id);
  }

  @Post()
  async create(@Body() dto: CreateAdminCustomerProfileDto): Promise<CustomerProfileResponseDto> {
    return await this.customerProfilesAdminService.create(dto);
  }

  @Post(':id')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CustomerProfileDto,
  ): Promise<CustomerProfileResponseDto> {
    return await this.customerProfilesAdminService.update(id, dto);
  }

  @Post(':id/trust-score/recompute')
  async recomputeTrustScore(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<CustomerTrustScoreResponseDto> {
    return await this.customerProfilesAdminService.recomputeTrustScore(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<void> {
    await this.customerProfilesAdminService.delete(id);
  }
}
