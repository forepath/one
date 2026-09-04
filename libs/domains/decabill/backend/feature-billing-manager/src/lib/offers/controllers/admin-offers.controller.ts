import { KeycloakRoles, RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';

import type { PaginatedBillingAuditLogsResponseDto } from '../../dto/admin-billing.dto';
import type {
  AdminOfferDetailResponseDto,
  CreateAdminOfferDto,
  OfferStatisticsResponseDto,
  PaginatedAdminOffersResponseDto,
  UpdateAdminOfferDto,
} from '../dto/offer.dto';
import { OffersAdminService } from '../services/offers-admin.service';
import { OfferStatisticsQueryService } from '../services/offer-statistics-query.service';
import { getUserFromRequest, type RequestWithUser } from '../../utils/billing-access.utils';

type AdminRequest = RequestWithUser;

@Controller('admin/billing/offers')
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
export class AdminOffersController {
  constructor(
    private readonly offersAdminService: OffersAdminService,
    private readonly offerStatisticsQueryService: OfferStatisticsQueryService,
  ) {}

  @Get()
  @RequireScopes('billing_admin:read')
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('userId', new ParseUUIDPipe({ version: '4', optional: true })) userId?: string,
  ): Promise<PaginatedAdminOffersResponseDto> {
    return await this.offersAdminService.list(limit ?? 10, offset ?? 0, search, userId);
  }

  @Get('statistics')
  @RequireScopes('billing_admin:read')
  async statistics(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: 'day' | 'month',
    @Query('userId', new ParseUUIDPipe({ version: '4', optional: true })) userId?: string,
  ): Promise<OfferStatisticsResponseDto> {
    const { fromDate, toDate } = this.parseDateRange(from, to);

    return await this.offerStatisticsQueryService.getStatistics({
      from: fromDate,
      to: toDate,
      groupBy: groupBy === 'month' ? 'month' : 'day',
      userId,
    });
  }

  @Post()
  @RequireScopes('billing_admin:write')
  async create(@Body() dto: CreateAdminOfferDto, @Req() req: AdminRequest): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.create(dto, getUserFromRequest(req)?.userId);
  }

  @Get(':id')
  @RequireScopes('billing_admin:read')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.get(id);
  }

  @Put(':id')
  @RequireScopes('billing_admin:write')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateAdminOfferDto,
    @Req() req: AdminRequest,
  ): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.update(id, dto, getUserFromRequest(req)?.userId);
  }

  @Delete(':id')
  @RequireScopes('billing_admin:write')
  async delete(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req: AdminRequest): Promise<void> {
    await this.offersAdminService.delete(id, getUserFromRequest(req)?.userId);
  }

  @Post(':id/archive')
  @RequireScopes('billing_admin:write')
  async archive(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: AdminRequest,
  ): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.archive(id, getUserFromRequest(req)?.userId);
  }

  @Post(':id/revoke')
  @RequireScopes('billing_admin:write')
  async revoke(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: AdminRequest,
  ): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.revoke(id, getUserFromRequest(req)?.userId);
  }

  @Get(':id/pdf')
  @RequireScopes('billing_admin:read')
  @Header('Content-Type', 'application/pdf')
  async downloadPdf(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<StreamableFile> {
    const { buffer, filename } = await this.offersAdminService.readPdf(id);

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get(':id/audit-logs')
  @RequireScopes('billing_admin:read')
  async listAuditLogs(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<PaginatedBillingAuditLogsResponseDto> {
    return await this.offersAdminService.getAuditLogs(id, limit ?? 10, offset ?? 0);
  }

  private parseDateRange(from?: string, to?: string): { fromDate: Date; toDate: Date } {
    if (!from?.trim() || !to?.trim()) {
      const toDate = new Date();
      const fromDate = new Date(toDate);

      fromDate.setDate(fromDate.getDate() - 30);

      return { fromDate, toDate };
    }

    const fromDate = new Date(`${from.trim().slice(0, 10)}T00:00:00.000Z`);
    const toDate = new Date(`${to.trim().slice(0, 10)}T23:59:59.999Z`);

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
      throw new BadRequestException('Invalid from/to date range');
    }

    return { fromDate, toDate };
  }
}
