import { KeycloakRoles, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import type {
  AdminBillNowDto,
  AdminBillNowResponseDto,
  AdminBillingSummaryResponseDto,
  BillingStatisticsByProductDto,
  BillingStatisticsSummaryDto,
  MarkInvoicePaymentStatusDto,
  PaginatedAdminInvoicesResponseDto,
  PaginatedBillingAuditLogsResponseDto,
} from '../dto/admin-billing.dto';
import type { AdminInvoiceListItemDto } from '../dto/admin-billing.dto';
import { AdminBillNowService } from '../services/admin-bill-now.service';
import { BillingAdminService } from '../services/billing-admin.service';
import { BillingAuditLogService } from '../services/billing-audit-log.service';
import { BillingStatisticsQueryService } from '../services/billing-statistics-query.service';
import { InvoiceAdminService } from '../services/invoice-admin.service';
import { getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

@Controller('admin/billing')
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
export class AdminBillingController {
  constructor(
    private readonly billingAdminService: BillingAdminService,
    private readonly adminBillNowService: AdminBillNowService,
    private readonly invoiceAdminService: InvoiceAdminService,
    private readonly statisticsQueryService: BillingStatisticsQueryService,
    private readonly auditLogService: BillingAuditLogService,
  ) {}

  @Get('summary')
  async getSummary(): Promise<AdminBillingSummaryResponseDto> {
    return await this.billingAdminService.getGlobalSummary();
  }

  @Post('bill-now')
  async billNow(@Body() dto: AdminBillNowDto, @Req() req?: RequestWithUser): Promise<AdminBillNowResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.adminBillNowService.queueBillNow(userInfo.userId, dto);
  }

  @Get('invoices')
  async listInvoices(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('userId') userId?: string,
  ): Promise<PaginatedAdminInvoicesResponseDto> {
    return await this.invoiceAdminService.listInvoices({
      limit: limit ?? 10,
      offset: offset ?? 0,
      search,
      userId,
    });
  }

  /** @deprecated Use GET /admin/billing/invoices */
  @Get('invoices/open-overdue')
  async listOpenOverdue(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('userId') userId?: string,
  ): Promise<PaginatedAdminInvoicesResponseDto> {
    return await this.listInvoices(limit, offset, search, userId);
  }

  @Post('invoices/:invoiceRefId/void')
  async voidInvoice(
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Req() req?: RequestWithUser,
  ): Promise<AdminInvoiceListItemDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.invoiceAdminService.voidInvoice(invoiceRefId, userInfo.userId);
  }

  @Post('invoices/:invoiceRefId/mark-paid')
  async markPaid(
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Body() dto: MarkInvoicePaymentStatusDto,
    @Req() req?: RequestWithUser,
  ): Promise<AdminInvoiceListItemDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.invoiceAdminService.markPaidManual(invoiceRefId, userInfo.userId, dto);
  }

  @Post('invoices/:invoiceRefId/mark-unpaid')
  async markUnpaid(
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Body() dto: MarkInvoicePaymentStatusDto,
    @Req() req?: RequestWithUser,
  ): Promise<AdminInvoiceListItemDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.invoiceAdminService.markUnpaidManual(invoiceRefId, userInfo.userId, dto);
  }

  @Get('invoices/:invoiceRefId/audit-logs')
  async listAuditLogs(
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<PaginatedBillingAuditLogsResponseDto> {
    const result = await this.auditLogService.listForInvoice(invoiceRefId, limit ?? 20, offset ?? 0);

    return {
      items: result.items,
      total: result.total,
      limit: limit ?? 20,
      offset: offset ?? 0,
    };
  }

  @Get('statistics/summary')
  async getStatisticsSummary(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: 'day' | 'month',
    @Query('userId') userId?: string,
  ): Promise<BillingStatisticsSummaryDto> {
    const { fromDate, toDate } = this.parseDateRange(from, to);

    return await this.statisticsQueryService.getSummary({
      from: fromDate,
      to: toDate,
      groupBy: groupBy === 'month' ? 'month' : 'day',
      userId,
    });
  }

  @Get('statistics/by-product')
  async getStatisticsByProduct(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ): Promise<BillingStatisticsByProductDto> {
    const { fromDate, toDate } = this.parseDateRange(from, to);

    return await this.statisticsQueryService.getByProduct({
      from: fromDate,
      to: toDate,
      userId,
    });
  }

  private parseDateRange(from?: string, to?: string): { fromDate: Date; toDate: Date } {
    const now = new Date();
    const defaultTo = now.toISOString().slice(0, 10);
    const defaultFromDate = new Date(now);

    defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 30);
    const defaultFrom = defaultFromDate.toISOString().slice(0, 10);
    const fromDate = this.parseDateBoundary(from ?? defaultFrom, 'start');
    const toDate = this.parseDateBoundary(to ?? defaultTo, 'end');

    if (fromDate > toDate) {
      throw new BadRequestException('Invalid date range: from must be before to');
    }

    return { fromDate, toDate };
  }

  private parseDateBoundary(value: string, boundary: 'start' | 'end'): Date {
    const date = new Date(`${value}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date range');
    }

    return date;
  }
}
