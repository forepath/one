import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
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
import { MarkDocumentSentDto } from '../../dto/document-delivery.dto';
import { getUserFromRequest, type RequestWithUser } from '../../utils/billing-access.utils';
import {
  AcceptAdminOfferDto,
  ArchiveAdminOfferDto,
  CreateAdminOfferDto,
  DeclineAdminOfferDto,
  RevokeAdminOfferDto,
  UpdateAdminOfferDto,
  type AdminOfferDetailResponseDto,
  type OfferStatisticsResponseDto,
  type PaginatedAdminOffersResponseDto,
} from '../dto/offer.dto';
import { OfferStatisticsQueryService } from '../services/offer-statistics-query.service';
import { OffersAdminService } from '../services/offers-admin.service';

type AdminRequest = RequestWithUser;

@Controller('admin/billing/offers')
@UsersRoles(UserRole.ADMIN, UserRole.MANAGER)
export class AdminOffersController {
  constructor(
    private readonly offersAdminService: OffersAdminService,
    private readonly offerStatisticsQueryService: OfferStatisticsQueryService,
  ) {}

  @Get()
  @RequireScopes('offers:admin')
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('userId', new ParseUUIDPipe({ version: '4', optional: true })) userId?: string,
  ): Promise<PaginatedAdminOffersResponseDto> {
    return await this.offersAdminService.list(limit ?? 10, offset ?? 0, search, userId);
  }

  @Get('statistics')
  @RequireScopes('offers:admin')
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
  @RequireScopes('offers:admin')
  async create(@Body() dto: CreateAdminOfferDto, @Req() req: AdminRequest): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.create(dto, getUserFromRequest(req)?.userId);
  }

  @Get(':id')
  @RequireScopes('offers:admin')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.get(id);
  }

  @Put(':id')
  @RequireScopes('offers:admin')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateAdminOfferDto,
    @Req() req: AdminRequest,
  ): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.update(id, dto, getUserFromRequest(req)?.userId);
  }

  @Delete(':id')
  @RequireScopes('offers:admin')
  async delete(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req: AdminRequest): Promise<void> {
    await this.offersAdminService.delete(id, getUserFromRequest(req)?.userId);
  }

  @Post(':id/archive')
  @RequireScopes('offers:admin')
  async archive(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ArchiveAdminOfferDto,
    @Req() req: AdminRequest,
  ): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.archive(id, getUserFromRequest(req)?.userId, dto);
  }

  /** Sends an offer that was archived without notification (email + visible to the customer). */
  @Post(':id/send')
  @RequireScopes('offers:admin')
  async send(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: AdminRequest,
  ): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.send(id, getUserFromRequest(req)?.userId);
  }

  /**
   * Sends an offer that was archived without notification as a physical letter through the tenant's postal provider.
   * Letters cost money, so tokens additionally need `letters:admin`.
   */
  @Post(':id/send-letter')
  @RequireScopes('offers:admin', 'letters:admin')
  async sendLetter(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: AdminRequest,
  ): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.sendLetter(id, getUserFromRequest(req)?.userId);
  }

  /** Records that an offer archived without notification was sent outside Decabill (nothing is sent). */
  @Post(':id/mark-sent')
  @RequireScopes('offers:admin')
  async markSent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: MarkDocumentSentDto,
    @Req() req: AdminRequest,
  ): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.markSent(id, getUserFromRequest(req)?.userId, dto);
  }

  @Post(':id/revoke')
  @RequireScopes('offers:admin')
  async revoke(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RevokeAdminOfferDto,
    @Req() req: AdminRequest,
  ): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.revoke(id, getUserFromRequest(req)?.userId, dto);
  }

  /** Records the customer's acceptance given outside the system (e.g. an offer that was not sent through it). */
  @Post(':id/accept')
  @RequireScopes('offers:admin')
  async accept(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AcceptAdminOfferDto,
    @Req() req: AdminRequest,
  ): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.accept(id, getUserFromRequest(req)?.userId, dto);
  }

  /** Records the customer's decline given outside the system. */
  @Post(':id/decline')
  @RequireScopes('offers:admin')
  async decline(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: DeclineAdminOfferDto,
    @Req() req: AdminRequest,
  ): Promise<AdminOfferDetailResponseDto> {
    return await this.offersAdminService.decline(id, getUserFromRequest(req)?.userId, dto);
  }

  @Get(':id/pdf')
  @RequireScopes('offers:admin')
  @Header('Content-Type', 'application/pdf')
  async downloadPdf(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<StreamableFile> {
    const { buffer, filename } = await this.offersAdminService.readPdf(id);

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get(':id/audit-logs')
  @RequireScopes('offers:admin')
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
