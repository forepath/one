import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseBoolPipe,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import type { RequestWithUser } from '../../utils/billing-access.utils';
import { getUserFromRequest } from '../../utils/billing-access.utils';
import { InventoryLendingStatus } from '../constants/inventory.constants';
import {
  CreateInventoryLendingDto,
  ReturnInventoryLendingDto,
  type InventoryLendingResponseDto,
  type PaginatedInventoryResponseDto,
} from '../dto/inventory.dto';
import { InventoryLendingsService } from '../services/inventory-lendings.service';

const UUID = new ParseUUIDPipe({ version: '4' });
const OPTIONAL_UUID = new ParseUUIDPipe({ version: '4', optional: true });

@Controller('admin/billing/inventory/lendings')
@UsersRoles(UserRole.ADMIN)
export class AdminInventoryLendingsController {
  constructor(private readonly lendings: InventoryLendingsService) {}

  @RequireScopes('inventory:admin')
  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('status', new ParseEnumPipe(InventoryLendingStatus, { optional: true })) status?: InventoryLendingStatus,
    @Query('overdue', new ParseBoolPipe({ optional: true })) overdue?: boolean,
    @Query('articleId', OPTIONAL_UUID) articleId?: string,
    @Query('borrowerUserId', OPTIONAL_UUID) borrowerUserId?: string,
  ): Promise<PaginatedInventoryResponseDto<InventoryLendingResponseDto>> {
    return await this.lendings.list(limit, offset, {
      search,
      status,
      overdueOnly: overdue === true,
      articleId,
      borrowerUserId,
    });
  }

  @RequireScopes('inventory:admin')
  @Get(':id')
  async get(@Param('id', UUID) id: string): Promise<InventoryLendingResponseDto> {
    return await this.lendings.get(id);
  }

  /** Lends stock (document `LND-…`); serial-tracked articles name the units. */
  @RequireScopes('inventory:admin')
  @Post()
  async lend(
    @Body() dto: CreateInventoryLendingDto,
    @Req() req: RequestWithUser,
  ): Promise<InventoryLendingResponseDto> {
    return await this.lendings.lend(dto, getUserFromRequest(req).userId);
  }

  /** Returns all or part of a lending into a compartment (document `RTN-…`). */
  @RequireScopes('inventory:admin')
  @Post(':id/return')
  async returnLending(
    @Param('id', UUID) id: string,
    @Body() dto: ReturnInventoryLendingDto,
    @Req() req: RequestWithUser,
  ): Promise<InventoryLendingResponseDto> {
    return await this.lendings.returnLending(id, dto, getUserFromRequest(req).userId);
  }
}
