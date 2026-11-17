import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import { Controller, Get, ParseEnumPipe, ParseIntPipe, ParseUUIDPipe, Query } from '@nestjs/common';

import { InventorySerialUnitStatus } from '../constants/inventory.constants';
import type { InventorySerialUnitResponseDto, PaginatedInventoryResponseDto } from '../dto/inventory.dto';
import { InventorySerialUnitsService } from '../services/inventory-serial-units.service';

const OPTIONAL_UUID = new ParseUUIDPipe({ version: '4', optional: true });

@Controller('admin/billing/inventory/serial-units')
@UsersRoles(UserRole.ADMIN)
export class AdminInventorySerialUnitsController {
  constructor(private readonly serialUnits: InventorySerialUnitsService) {}

  /** Units by article / status / compartment / lending; `search` matches serial number, article and borrower. */
  @RequireScopes('inventory:admin')
  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('status', new ParseEnumPipe(InventorySerialUnitStatus, { optional: true }))
    status?: InventorySerialUnitStatus,
    @Query('articleId', OPTIONAL_UUID) articleId?: string,
    @Query('compartmentId', OPTIONAL_UUID) compartmentId?: string,
    @Query('lendingId', OPTIONAL_UUID) lendingId?: string,
  ): Promise<PaginatedInventoryResponseDto<InventorySerialUnitResponseDto>> {
    return await this.serialUnits.list(limit, offset, { search, status, articleId, compartmentId, lendingId });
  }
}
