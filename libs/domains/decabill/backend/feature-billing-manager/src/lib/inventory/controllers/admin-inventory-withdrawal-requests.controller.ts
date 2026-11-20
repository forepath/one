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
} from '@nestjs/common';

import type { RequestWithUser } from '../../utils/billing-access.utils';
import { getUserFromRequest } from '../../utils/billing-access.utils';
import { InventoryWithdrawalRequestStatus } from '../constants/inventory.constants';
import {
  AcceptInventoryWithdrawalRequestDto,
  RejectInventoryWithdrawalRequestDto,
  type InventoryWithdrawalRequestResponseDto,
  type PaginatedInventoryResponseDto,
} from '../dto/inventory.dto';
import { InventoryWithdrawalRequestsService } from '../services/inventory-withdrawal-requests.service';

const UUID = new ParseUUIDPipe({ version: '4' });

@Controller('admin/billing/inventory/withdrawal-requests')
@UsersRoles(UserRole.ADMIN)
export class AdminInventoryWithdrawalRequestsController {
  constructor(private readonly requests: InventoryWithdrawalRequestsService) {}

  @RequireScopes('inventory:admin')
  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('status', new ParseEnumPipe(InventoryWithdrawalRequestStatus, { optional: true }))
    status?: InventoryWithdrawalRequestStatus,
    @Query('articleId', new ParseUUIDPipe({ version: '4', optional: true })) articleId?: string,
  ): Promise<PaginatedInventoryResponseDto<InventoryWithdrawalRequestResponseDto>> {
    return await this.requests.list(limit, offset, { search, status, articleId });
  }

  @RequireScopes('inventory:admin')
  @Get(':id')
  async get(@Param('id', UUID) id: string): Promise<InventoryWithdrawalRequestResponseDto> {
    return await this.requests.get(id);
  }

  @RequireScopes('inventory:admin')
  @Post(':id/accept')
  async accept(
    @Param('id', UUID) id: string,
    @Body() dto: AcceptInventoryWithdrawalRequestDto,
    @Req() req: RequestWithUser,
  ): Promise<InventoryWithdrawalRequestResponseDto> {
    return await this.requests.accept(id, dto, getUserFromRequest(req).userId);
  }

  @RequireScopes('inventory:admin')
  @Post(':id/reject')
  async reject(
    @Param('id', UUID) id: string,
    @Body() dto: RejectInventoryWithdrawalRequestDto,
    @Req() req: RequestWithUser,
  ): Promise<InventoryWithdrawalRequestResponseDto> {
    return await this.requests.reject(id, dto, getUserFromRequest(req).userId);
  }
}
