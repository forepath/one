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
import {
  CreateInventoryArticleDto,
  UpdateInventoryArticleDto,
  type InventoryArticleResponseDto,
  type InventoryStockResponseDto,
  type InventorySummaryResponseDto,
  type PaginatedInventoryResponseDto,
} from '../dto/inventory.dto';
import { InventoryArticlesService } from '../services/inventory-articles.service';
import { InventoryLocationsService } from '../services/inventory-locations.service';

const UUID = new ParseUUIDPipe({ version: '4' });

@Controller('admin/billing/inventory')
@UsersRoles(UserRole.ADMIN, UserRole.MANAGER)
export class AdminInventoryArticlesController {
  constructor(
    private readonly articles: InventoryArticlesService,
    private readonly locations: InventoryLocationsService,
  ) {}

  @RequireScopes('inventory:admin')
  @Get('summary')
  async summary(): Promise<InventorySummaryResponseDto> {
    return await this.articles.summary();
  }

  @RequireScopes('inventory:admin')
  @Get('articles')
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('activeOnly', new ParseBoolPipe({ optional: true })) activeOnly?: boolean,
    @Query('lowStockOnly', new ParseBoolPipe({ optional: true })) lowStockOnly?: boolean,
  ): Promise<PaginatedInventoryResponseDto<InventoryArticleResponseDto>> {
    return await this.articles.list(limit, offset, { search, activeOnly, lowStockOnly });
  }

  @RequireScopes('inventory:admin')
  @Get('articles/:id')
  async get(@Param('id', UUID) id: string): Promise<InventoryArticleResponseDto> {
    return await this.articles.get(id);
  }

  /** Locations of the article (most stock first) — also the suggestion list of moves. */
  @RequireScopes('inventory:admin')
  @Get('articles/:id/stock')
  async stock(
    @Param('id', UUID) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('withStockOnly', new ParseBoolPipe({ optional: true })) withStockOnly?: boolean,
  ): Promise<PaginatedInventoryResponseDto<InventoryStockResponseDto>> {
    return await this.locations.listArticleStock(id, limit, offset, { search, withStockOnly });
  }

  @RequireScopes('inventory:admin')
  @Post('articles')
  async create(
    @Body() dto: CreateInventoryArticleDto,
    @Req() req: RequestWithUser,
  ): Promise<InventoryArticleResponseDto> {
    return await this.articles.create(dto, getUserFromRequest(req).userId);
  }

  @RequireScopes('inventory:admin')
  @Post('articles/:id')
  async update(
    @Param('id', UUID) id: string,
    @Body() dto: UpdateInventoryArticleDto,
    @Req() req: RequestWithUser,
  ): Promise<InventoryArticleResponseDto> {
    return await this.articles.update(id, dto, getUserFromRequest(req).userId);
  }

  @RequireScopes('inventory:admin')
  @Delete('articles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', UUID) id: string, @Req() req: RequestWithUser): Promise<void> {
    await this.articles.delete(id, getUserFromRequest(req).userId);
  }
}
