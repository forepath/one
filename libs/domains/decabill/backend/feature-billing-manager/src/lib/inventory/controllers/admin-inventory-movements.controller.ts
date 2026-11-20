import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';

import type { RequestWithUser } from '../../utils/billing-access.utils';
import { getUserFromRequest } from '../../utils/billing-access.utils';
import { InventoryMovementType } from '../constants/inventory.constants';
import {
  InventoryPutawayDto,
  InventoryTransferDto,
  InventoryWithdrawalDto,
  type InventoryMovementResponseDto,
  type PaginatedInventoryResponseDto,
} from '../dto/inventory.dto';
import { InventoryMovementsService } from '../services/inventory-movements.service';

const UUID = new ParseUUIDPipe({ version: '4' });
const OPTIONAL_UUID = new ParseUUIDPipe({ version: '4', optional: true });

@Controller('admin/billing/inventory/movements')
@UsersRoles(UserRole.ADMIN)
export class AdminInventoryMovementsController {
  constructor(private readonly movements: InventoryMovementsService) {}

  @RequireScopes('inventory:admin')
  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('type', new ParseEnumPipe(InventoryMovementType, { optional: true })) type?: InventoryMovementType,
    @Query('articleId', OPTIONAL_UUID) articleId?: string,
    @Query('compartmentId', OPTIONAL_UUID) compartmentId?: string,
    @Query('warehouseId', OPTIONAL_UUID) warehouseId?: string,
    @Query('requestId', OPTIONAL_UUID) requestId?: string,
    @Query('lendingId', OPTIONAL_UUID) lendingId?: string,
    @Query('serialNumber') serialNumber?: string,
  ): Promise<PaginatedInventoryResponseDto<InventoryMovementResponseDto>> {
    return await this.movements.list(limit, offset, {
      search,
      type,
      articleId,
      compartmentId,
      warehouseId,
      withdrawalRequestId: requestId,
      lendingId,
      // Exact match of one serial number (unit history); longer values cannot exist.
      serialNumber: serialNumber?.trim() ? serialNumber.trim().slice(0, 128) : undefined,
    });
  }

  @RequireScopes('inventory:admin')
  @Get(':id')
  async get(@Param('id', UUID) id: string): Promise<InventoryMovementResponseDto> {
    return await this.movements.get(id);
  }

  @RequireScopes('inventory:admin')
  @Get(':id/pdf')
  async pdf(@Param('id', UUID) id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { buffer, fileName } = await this.movements.getPdf(id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    return new StreamableFile(buffer);
  }

  @RequireScopes('inventory:admin')
  @Post('putaway')
  async putaway(@Body() dto: InventoryPutawayDto, @Req() req: RequestWithUser): Promise<InventoryMovementResponseDto> {
    return await this.movements.putaway(dto, getUserFromRequest(req).userId);
  }

  @RequireScopes('inventory:admin')
  @Post('transfer')
  async transfer(
    @Body() dto: InventoryTransferDto,
    @Req() req: RequestWithUser,
  ): Promise<InventoryMovementResponseDto> {
    return await this.movements.transfer(dto, getUserFromRequest(req).userId);
  }

  @RequireScopes('inventory:admin')
  @Post('withdrawal')
  async withdrawal(
    @Body() dto: InventoryWithdrawalDto,
    @Req() req: RequestWithUser,
  ): Promise<InventoryMovementResponseDto> {
    return await this.movements.withdraw(dto, getUserFromRequest(req).userId);
  }
}
