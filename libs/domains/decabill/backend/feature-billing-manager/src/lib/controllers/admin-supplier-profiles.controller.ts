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
  AdminSupplierProfileDetailDto,
  CreateAdminSupplierProfileDto,
  PaginatedAdminSupplierProfilesResponseDto,
  SupplierProfileFieldsDto,
} from '../dto/admin-supplier-profile.dto';
import { AddSupplierProfileCustomDataDto, UpdateSupplierProfileCustomDataDto } from '../dto/admin-supplier-profile.dto';
import { SupplierProfilesAdminService } from '../services/supplier-profiles-admin.service';

@Controller('admin/billing/supplier-profiles')
@UsersRoles(UserRole.ADMIN)
@RequireScopes('supplier_profile:admin')
export class AdminSupplierProfilesController {
  constructor(private readonly supplierProfilesAdminService: SupplierProfilesAdminService) {}

  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
  ): Promise<PaginatedAdminSupplierProfilesResponseDto> {
    return await this.supplierProfilesAdminService.list(limit ?? 10, offset ?? 0, search);
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AdminSupplierProfileDetailDto> {
    return await this.supplierProfilesAdminService.getById(id);
  }

  @Post()
  async create(@Body() dto: CreateAdminSupplierProfileDto): Promise<AdminSupplierProfileDetailDto> {
    return await this.supplierProfilesAdminService.create(dto);
  }

  @Post(':id')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SupplierProfileFieldsDto,
  ): Promise<AdminSupplierProfileDetailDto> {
    return await this.supplierProfilesAdminService.update(id, dto);
  }

  @Post(':id/vat-id/revalidate')
  async revalidateVatId(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<AdminSupplierProfileDetailDto> {
    return await this.supplierProfilesAdminService.revalidateVatId(id);
  }

  @Post(':id/vat-id/mark-validated')
  async markVatIdValidated(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<AdminSupplierProfileDetailDto> {
    return await this.supplierProfilesAdminService.markVatIdValidated(id);
  }

  @Post(':id/data')
  async addCustomData(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AddSupplierProfileCustomDataDto,
  ): Promise<AdminSupplierProfileDetailDto> {
    return await this.supplierProfilesAdminService.addCustomData(id, dto.key, dto.value);
  }

  @Post(':id/data/:key')
  async updateCustomData(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('key') key: string,
    @Body() dto: UpdateSupplierProfileCustomDataDto,
  ): Promise<AdminSupplierProfileDetailDto> {
    return await this.supplierProfilesAdminService.updateCustomData(id, key, dto.value);
  }

  @Delete(':id/data/:key')
  async deleteCustomData(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('key') key: string,
  ): Promise<AdminSupplierProfileDetailDto> {
    return await this.supplierProfilesAdminService.deleteCustomData(id, key);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<void> {
    await this.supplierProfilesAdminService.delete(id);
  }
}
