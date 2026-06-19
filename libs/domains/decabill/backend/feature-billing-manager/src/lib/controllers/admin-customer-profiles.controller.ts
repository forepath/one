import { KeycloakRoles, UserRole, UsersRoles } from '@forepath/identity/backend';
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
  CreateAdminCustomerProfileDto,
  PaginatedAdminCustomerProfilesResponseDto,
} from '../dto/admin-customer-profile.dto';
import { CustomerProfileDto } from '../dto/customer-profile.dto';
import type { CustomerProfileResponseDto } from '../dto/customer-profile-response.dto';
import { CustomerProfilesAdminService } from '../services/customer-profiles-admin.service';

@Controller('admin/billing/customer-profiles')
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
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
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.customerProfilesAdminService.getById(id);
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<void> {
    await this.customerProfilesAdminService.delete(id);
  }
}
