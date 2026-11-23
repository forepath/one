import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import type { RequestWithUser } from '../../utils/billing-access.utils';
import { getUserFromRequest } from '../../utils/billing-access.utils';
// Request DTOs are value imports: with `import type` the param metadata is `Object` and validation is skipped.
import {
  CreateInventoryCompartmentDto,
  CreateInventoryPlacementDto,
  CreateInventoryWarehouseDto,
  UpdateInventoryCompartmentDto,
  UpdateInventoryWarehouseDto,
  type InventoryCompartmentResponseDto,
  type InventoryStockResponseDto,
  type InventoryWarehouseResponseDto,
  type PaginatedInventoryResponseDto,
} from '../dto/inventory.dto';
import { InventoryLocationsService } from '../services/inventory-locations.service';

const UUID = new ParseUUIDPipe({ version: '4' });
const OPTIONAL_UUID = new ParseUUIDPipe({ version: '4', optional: true });

@Controller('admin/billing/inventory')
@UsersRoles(UserRole.ADMIN, UserRole.MANAGER)
export class AdminInventoryLocationsController {
  constructor(private readonly locations: InventoryLocationsService) {}

  // ---- Warehouses ----

  @RequireScopes('inventory:admin')
  @Get('warehouses')
  async listWarehouses(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
  ): Promise<PaginatedInventoryResponseDto<InventoryWarehouseResponseDto>> {
    return await this.locations.listWarehouses(limit, offset, search);
  }

  @RequireScopes('inventory:admin')
  @Get('warehouses/:id')
  async getWarehouse(@Param('id', UUID) id: string): Promise<InventoryWarehouseResponseDto> {
    return await this.locations.getWarehouse(id);
  }

  @RequireScopes('inventory:admin')
  @Post('warehouses')
  async createWarehouse(
    @Body() dto: CreateInventoryWarehouseDto,
    @Req() req: RequestWithUser,
  ): Promise<InventoryWarehouseResponseDto> {
    return await this.locations.createWarehouse(dto, getUserFromRequest(req).userId);
  }

  @RequireScopes('inventory:admin')
  @Post('warehouses/:id')
  async updateWarehouse(
    @Param('id', UUID) id: string,
    @Body() dto: UpdateInventoryWarehouseDto,
    @Req() req: RequestWithUser,
  ): Promise<InventoryWarehouseResponseDto> {
    return await this.locations.updateWarehouse(id, dto, getUserFromRequest(req).userId);
  }

  @RequireScopes('inventory:admin')
  @Delete('warehouses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWarehouse(@Param('id', UUID) id: string, @Req() req: RequestWithUser): Promise<void> {
    await this.locations.deleteWarehouse(id, getUserFromRequest(req).userId);
  }

  // ---- Compartments ----

  /** Compartments of a warehouse, or of all warehouses (target / source typeahead) without `warehouseId`. */
  @RequireScopes('inventory:admin')
  @Get('compartments')
  async listCompartments(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('warehouseId', OPTIONAL_UUID) warehouseId?: string,
    @Query('activeOnly', new ParseBoolPipe({ optional: true })) activeOnly?: boolean,
  ): Promise<PaginatedInventoryResponseDto<InventoryCompartmentResponseDto>> {
    return await this.locations.listCompartments(limit, offset, { warehouseId, search, activeOnly });
  }

  @RequireScopes('inventory:admin')
  @Get('compartments/:id')
  async getCompartment(@Param('id', UUID) id: string): Promise<InventoryCompartmentResponseDto> {
    return await this.locations.getCompartment(id);
  }

  @RequireScopes('inventory:admin')
  @Post('warehouses/:id/compartments')
  async createCompartment(
    @Param('id', UUID) warehouseId: string,
    @Body() dto: CreateInventoryCompartmentDto,
    @Req() req: RequestWithUser,
  ): Promise<InventoryCompartmentResponseDto> {
    return await this.locations.createCompartment(warehouseId, dto, getUserFromRequest(req).userId);
  }

  @RequireScopes('inventory:admin')
  @Post('compartments/:id')
  async updateCompartment(
    @Param('id', UUID) id: string,
    @Body() dto: UpdateInventoryCompartmentDto,
    @Req() req: RequestWithUser,
  ): Promise<InventoryCompartmentResponseDto> {
    return await this.locations.updateCompartment(id, dto, getUserFromRequest(req).userId);
  }

  @RequireScopes('inventory:admin')
  @Delete('compartments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCompartment(@Param('id', UUID) id: string, @Req() req: RequestWithUser): Promise<void> {
    await this.locations.deleteCompartment(id, getUserFromRequest(req).userId);
  }

  @RequireScopes('inventory:admin')
  @Get('compartments/:id/stock')
  async listCompartmentStock(
    @Param('id', UUID) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
  ): Promise<PaginatedInventoryResponseDto<InventoryStockResponseDto>> {
    return await this.locations.listCompartmentStock(id, limit, offset, search);
  }

  // ---- Placements ----

  @RequireScopes('inventory:admin')
  @Get('stock/:id')
  async getPlacement(@Param('id', UUID) id: string): Promise<InventoryStockResponseDto> {
    return await this.locations.getPlacement(id);
  }

  /** Maps an article to a compartment with quantity 0. */
  @RequireScopes('inventory:admin')
  @Post('stock')
  async createPlacement(
    @Body() dto: CreateInventoryPlacementDto,
    @Req() req: RequestWithUser,
  ): Promise<InventoryStockResponseDto> {
    return await this.locations.createPlacement(dto, getUserFromRequest(req).userId);
  }

  @RequireScopes('inventory:admin')
  @Delete('stock/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePlacement(@Param('id', UUID) id: string, @Req() req: RequestWithUser): Promise<void> {
    await this.locations.deletePlacement(id, getUserFromRequest(req).userId);
  }
}
