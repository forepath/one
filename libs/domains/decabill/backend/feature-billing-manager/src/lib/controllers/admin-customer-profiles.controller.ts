import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
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
import { AddCustomerProfileCustomDataDto, UpdateCustomerProfileCustomDataDto } from '../dto/admin-customer-profile.dto';
import type { CustomerProfileResponseDto } from '../dto/customer-profile-response.dto';
import { CustomerProfileDto } from '../dto/customer-profile.dto';
import type { CustomerTrustScoreResponseDto } from '../dto/customer-trust-score.dto';
import { CustomerProfilesAdminService } from '../services/customer-profiles-admin.service';

@Controller('admin/billing/customer-profiles')
@UsersRoles(UserRole.ADMIN)
@RequireScopes('customer_profile:admin')
export class AdminCustomerProfilesController {
  constructor(private readonly customerProfilesAdminService: CustomerProfilesAdminService) {}

  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
  ): Promise<PaginatedAdminCustomerProfilesResponseDto> {
    return await this.customerProfilesAdminService.list(limit ?? 10, offset ?? 0, search);
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

  @Post(':id/vat-id/revalidate')
  async revalidateVatId(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<CustomerProfileResponseDto> {
    return await this.customerProfilesAdminService.revalidateVatId(id);
  }

  @Post(':id/vat-id/mark-validated')
  async markVatIdValidated(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<CustomerProfileResponseDto> {
    return await this.customerProfilesAdminService.markVatIdValidated(id);
  }

  @Post(':id/data')
  async addCustomData(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AddCustomerProfileCustomDataDto,
  ): Promise<AdminCustomerProfileDetailDto> {
    return await this.customerProfilesAdminService.addCustomData(id, dto.key, dto.value);
  }

  @Post(':id/data/:key')
  async updateCustomData(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('key') key: string,
    @Body() dto: UpdateCustomerProfileCustomDataDto,
  ): Promise<AdminCustomerProfileDetailDto> {
    return await this.customerProfilesAdminService.updateCustomData(id, key, dto.value);
  }

  @Delete(':id/data/:key')
  async deleteCustomData(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('key') key: string,
  ): Promise<AdminCustomerProfileDetailDto> {
    return await this.customerProfilesAdminService.deleteCustomData(id, key);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<void> {
    await this.customerProfilesAdminService.delete(id);
  }
}
