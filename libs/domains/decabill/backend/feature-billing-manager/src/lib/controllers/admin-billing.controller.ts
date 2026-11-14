import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import { getTenantIdOrDefault } from '@forepath/shared/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';

import { MarkInvoicePaymentStatusDto } from '../dto/admin-billing.dto';
import type {
  AdminBillNowDto,
  AdminBillNowResponseDto,
  AdminBillingSummaryResponseDto,
  AdminSubscriptionListItemDto,
  BillingStatisticsByCountryDto,
  BillingStatisticsByProductDto,
  BillingStatisticsSummaryDto,
  PaginatedAdminInvoicesResponseDto,
  PaginatedBillingAuditLogsResponseDto,
  PaginatedAdminSubscriptionsResponseDto,
} from '../dto/admin-billing.dto';
import type { AdminInvoiceListItemDto } from '../dto/admin-billing.dto';
import type { BillingCapabilitiesResponseDto } from '../dto/admin-datev-export.dto';
import { CancelSubscriptionDto } from '../dto/cancel-subscription.dto';
import { type EffectiveDocumentTermsResponseDto, mapEffectiveDocumentTermsToResponse } from '../dto/document-terms.dto';
import { InstantCancelSubscriptionDto } from '../dto/instant-cancel-subscription.dto';
import type {
  CreateManualInvoiceDto,
  IssueManualInvoiceDto,
  ManualInvoiceDetailResponseDto,
  UpdateManualInvoiceDto,
} from '../dto/manual-invoice.dto';
import { ResumeSubscriptionDto } from '../dto/resume-subscription.dto';
import { SubscriptionResponseDto } from '../dto/subscription-response.dto';
import { TaxPreviewRequestDto } from '../dto/tax-preview.dto';
import { WithdrawSubscriptionDto } from '../dto/withdraw-subscription.dto';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { AdminBillNowService } from '../services/admin-bill-now.service';
import { BillingAdminService } from '../services/billing-admin.service';
import { BillingAuditLogService } from '../services/billing-audit-log.service';
import { BillingDocumentTermsConfigService } from '../services/billing-document-terms-config.service';
import { BillingStatisticsQueryService } from '../services/billing-statistics-query.service';
import { BillingTenantService } from '../services/billing-tenant.service';
import { DatevExportConfigService } from '../services/datev-export-config.service';
import { InvoiceAdminService } from '../services/invoice-admin.service';
import { InvoiceService } from '../services/invoice.service';
import { ManualInvoiceService } from '../services/manual-invoice.service';
import { StoredFileSigningConfigService } from '../services/stored-file-signing-config.service';
import { TaxPreviewService } from '../services/tax-preview.service';
import { TenantsGlobalViewsConfigService } from '../services/tenants-global-views-config.service';
import { getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

@Controller('admin/billing')
@UsersRoles(UserRole.ADMIN)
export class AdminBillingController {
  constructor(
    private readonly billingAdminService: BillingAdminService,
    private readonly adminBillNowService: AdminBillNowService,
    private readonly invoiceAdminService: InvoiceAdminService,
    private readonly manualInvoiceService: ManualInvoiceService,
    private readonly statisticsQueryService: BillingStatisticsQueryService,
    private readonly auditLogService: BillingAuditLogService,
    private readonly invoiceService: InvoiceService,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly datevExportConfigService: DatevExportConfigService,
    private readonly tenantsGlobalViewsConfig: TenantsGlobalViewsConfigService,
    private readonly billingTenantService: BillingTenantService,
    private readonly taxPreviewService: TaxPreviewService,
    private readonly storedFileSigningConfig: StoredFileSigningConfigService,
    private readonly documentTermsConfig: BillingDocumentTermsConfigService,
  ) {}

  @RequireScopes('billing:admin')
  @Post('tax/preview')
  async previewTax(@Body() dto: TaxPreviewRequestDto) {
    return await this.taxPreviewService.preview(dto);
  }

  /** Global default payment / delivery terms (`BILLING_DEFAULT_*`), shown as the inherited value in admin forms. */
  @RequireScopes('billing:admin')
  @Get('document-terms/defaults')
  getDocumentTermsDefaults(): EffectiveDocumentTermsResponseDto {
    return mapEffectiveDocumentTermsToResponse(this.documentTermsConfig.getDefaults());
  }

  @RequireScopes('billing:admin')
  @Get('capabilities')
  getCapabilities(): BillingCapabilitiesResponseDto {
    const tenantId = getTenantIdOrDefault();
    const globalViewsAllowed = this.tenantsGlobalViewsConfig.isGlobalViewsAllowedForTenant(tenantId);

    return {
      datevExportEnabled: this.datevExportConfigService.isEnabled(),
      unifiedExportAllowed: this.datevExportConfigService.isUnifiedExportAllowedForTenant(tenantId),
      globalViewsAllowed,
      viewableTenants: globalViewsAllowed ? [...this.billingTenantService.getConfiguredTenants()] : [tenantId],
      fileSigningEnabled: Boolean(this.storedFileSigningConfig.getSecret()),
    };
  }

  @RequireScopes('billing:admin')
  @Get('summary')
  async getSummary(): Promise<AdminBillingSummaryResponseDto> {
    return await this.billingAdminService.getGlobalSummary();
  }

  @RequireScopes('billing:admin')
  @Post('bill-now')
  async billNow(@Body() dto: AdminBillNowDto, @Req() req?: RequestWithUser): Promise<AdminBillNowResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.adminBillNowService.queueBillNow(userInfo.userId, dto);
  }

  @RequireScopes('subscriptions:admin')
  @Get('users/:userId/subscriptions')
  async listUserSubscriptions(
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<SubscriptionResponseDto[]> {
    return await this.billingAdminService.listUserSubscriptions(userId, limit ?? 100, offset ?? 0);
  }

  @RequireScopes('subscriptions:admin')
  @Get('subscriptions')
  async listSubscriptions(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('userId') userId?: string,
  ): Promise<PaginatedAdminSubscriptionsResponseDto> {
    return await this.billingAdminService.listSubscriptionsForAdmin({
      limit: limit ?? 10,
      offset: offset ?? 0,
      search,
      userId,
    });
  }

  @RequireScopes('subscriptions:admin')
  @Post('subscriptions/:id/cancel')
  async cancelSubscription(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() _dto: CancelSubscriptionDto,
  ): Promise<AdminSubscriptionListItemDto> {
    return await this.billingAdminService.cancelSubscriptionForAdmin(id);
  }

  @RequireScopes('subscriptions:admin')
  @Post('subscriptions/:id/withdraw')
  async withdrawSubscription(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() _dto: WithdrawSubscriptionDto,
  ): Promise<AdminSubscriptionListItemDto> {
    return await this.billingAdminService.withdrawSubscriptionForAdmin(id);
  }

  @RequireScopes('subscriptions:admin')
  @Post('subscriptions/:id/instant-cancel')
  async instantCancelSubscription(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() _dto: InstantCancelSubscriptionDto,
  ): Promise<AdminSubscriptionListItemDto> {
    return await this.billingAdminService.instantCancelSubscriptionForAdmin(id);
  }

  @RequireScopes('subscriptions:admin')
  @Post('subscriptions/:id/resume')
  async resumeSubscription(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() _dto: ResumeSubscriptionDto,
  ): Promise<AdminSubscriptionListItemDto> {
    return await this.billingAdminService.resumeSubscriptionForAdmin(id);
  }

  @RequireScopes('invoices:admin')
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
  @RequireScopes('invoices:admin')
  @Get('invoices/open-overdue')
  async listOpenOverdue(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('userId') userId?: string,
  ): Promise<PaginatedAdminInvoicesResponseDto> {
    return await this.listInvoices(limit, offset, search, userId);
  }

  @RequireScopes('invoices:admin')
  @Post('invoices/manual')
  async createManualInvoice(
    @Body() dto: CreateManualInvoiceDto,
    @Req() req?: RequestWithUser,
  ): Promise<ManualInvoiceDetailResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.manualInvoiceService.createDraft(dto, userInfo.userId);
  }

  @RequireScopes('invoices:admin')
  @Get('invoices/:invoiceRefId')
  async getInvoiceDetail(
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
  ): Promise<ManualInvoiceDetailResponseDto> {
    return await this.manualInvoiceService.getDetail(invoiceRefId);
  }

  @RequireScopes('invoices:admin')
  @Post('invoices/:invoiceRefId/issue')
  async issueManualInvoice(
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Body() dto: IssueManualInvoiceDto,
    @Req() req?: RequestWithUser,
  ): Promise<ManualInvoiceDetailResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.manualInvoiceService.issueDraft(invoiceRefId, userInfo.userId, dto);
  }

  @RequireScopes('invoices:admin')
  @Post('invoices/:invoiceRefId')
  async updateManualInvoice(
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Body() dto: UpdateManualInvoiceDto,
    @Req() req?: RequestWithUser,
  ): Promise<ManualInvoiceDetailResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.manualInvoiceService.updateDraft(invoiceRefId, dto, userInfo.userId);
  }

  @RequireScopes('invoices:admin')
  @Delete('invoices/:invoiceRefId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteManualInvoice(
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    await this.manualInvoiceService.deleteDraft(invoiceRefId, userInfo.userId);
  }

  @RequireScopes('invoices:admin')
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

  @RequireScopes('invoices:admin')
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

  @RequireScopes('invoices:admin')
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

  @RequireScopes('invoices:admin')
  @Get('invoices/:invoiceRefId/pdf')
  @Header('Content-Type', 'application/pdf')
  async downloadInvoicePdf(
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<StreamableFile> {
    const invoice = await this.invoicesRepository.findById(invoiceRefId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const buffer = await this.invoiceService.getPdfBuffer(invoiceRefId, invoice.subscriptionId);
    const filename = `${invoice.invoiceNumber ?? invoiceRefId}.pdf`;

    res?.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return new StreamableFile(buffer);
  }

  @RequireScopes('invoices:admin')
  @Get('invoices/:invoiceRefId/void-document/pdf')
  @Header('Content-Type', 'application/pdf')
  async downloadVoidDocumentPdf(
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<StreamableFile> {
    const invoice = await this.invoicesRepository.findById(invoiceRefId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const buffer = await this.invoiceService.getVoidPdfBuffer(invoiceRefId, invoice.subscriptionId);
    const filename = `${invoice.invoiceNumber ?? invoiceRefId}-void.pdf`;

    res?.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return new StreamableFile(buffer);
  }

  @RequireScopes('invoices:admin')
  @Get('invoices/:invoiceRefId/time-report/pdf')
  @Header('Content-Type', 'application/pdf')
  async downloadTimeReportPdf(
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<StreamableFile> {
    const invoice = await this.invoicesRepository.findById(invoiceRefId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const buffer = await this.invoiceService.getTimeReportPdfBuffer(invoiceRefId, invoice.subscriptionId);
    const filename = `time-report-${invoice.invoiceNumber ?? invoiceRefId}.pdf`;

    res?.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return new StreamableFile(buffer);
  }

  @RequireScopes('invoices:admin')
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

  @RequireScopes('billing:admin')
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

  @RequireScopes('billing:admin')
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

  @RequireScopes('billing:admin')
  @Get('statistics/by-country')
  async getStatisticsByCountry(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ): Promise<BillingStatisticsByCountryDto> {
    const { fromDate, toDate } = this.parseDateRange(from, to);

    return await this.statisticsQueryService.getByCountry({
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
