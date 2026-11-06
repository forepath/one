import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import type { PaginatedBillingAuditLogsResponseDto } from '../dto/admin-billing.dto';
import type { SupplierContractResponseDto } from '../dto/admin-supplier-profile.dto';
import {
  CreateSupplierInvoiceDto,
  IssueSupplierInvoiceDto,
  MarkSupplierInvoicePaymentStatusDto,
  UpdateSupplierInvoiceDto,
  type PaginatedSupplierInvoicesResponseDto,
  type SupplierExpenseStatisticsResponseDto,
  type SupplierInvoiceDetailResponseDto,
  type SupplierInvoiceParsePreviewResponseDto,
} from '../dto/supplier-invoice.dto';
import { BillingAuditLogService } from '../services/billing-audit-log.service';
import { EInvoiceInboundParseService } from '../services/e-invoice-inbound-parse.service';
import { SupplierContractsService } from '../services/supplier-contracts.service';
import {
  SupplierInvoicesAdminService,
  type UploadedSupplierDocument,
} from '../services/supplier-invoices-admin.service';

type AdminRequest = { user?: { id?: string } };

@Controller('admin/billing')
@UsersRoles(UserRole.ADMIN)
export class AdminSupplierInvoicesController {
  constructor(
    private readonly supplierInvoicesAdminService: SupplierInvoicesAdminService,
    private readonly supplierContractsService: SupplierContractsService,
    private readonly eInvoiceInboundParseService: EInvoiceInboundParseService,
    private readonly auditLogService: BillingAuditLogService,
  ) {}

  @Get('supplier-invoices/statistics')
  @RequireScopes('supplier_invoices:admin')
  async statistics(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: 'day' | 'month',
    @Query('supplierId', new ParseUUIDPipe({ version: '4', optional: true })) supplierId?: string,
  ): Promise<SupplierExpenseStatisticsResponseDto> {
    const { fromDate, toDate } = this.parseDateRange(from, to);

    return await this.supplierInvoicesAdminService.getStatistics({
      from: fromDate,
      to: toDate,
      groupBy: groupBy === 'month' ? 'month' : 'day',
      supplierId,
    });
  }

  @Get('supplier-invoices')
  @RequireScopes('supplier_invoices:admin')
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('supplierId', new ParseUUIDPipe({ version: '4', optional: true })) supplierId?: string,
    @Query('status', new ParseEnumPipe(InvoiceStatus, { optional: true })) status?: InvoiceStatus,
  ): Promise<PaginatedSupplierInvoicesResponseDto> {
    return await this.supplierInvoicesAdminService.list({
      limit: limit ?? 10,
      offset: offset ?? 0,
      search,
      supplierId,
      status,
    });
  }

  @Get('supplier-invoices/:id')
  @RequireScopes('supplier_invoices:admin')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<SupplierInvoiceDetailResponseDto> {
    return await this.supplierInvoicesAdminService.getById(id);
  }

  @Get('supplier-invoices/:id/document')
  @RequireScopes('supplier_invoices:admin')
  async downloadDocument(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, fileName } = await this.supplierInvoicesAdminService.downloadDocument(id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Get('supplier-invoices/:id/audit-logs')
  @RequireScopes('supplier_invoices:admin')
  async listAuditLogs(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<PaginatedBillingAuditLogsResponseDto> {
    await this.supplierInvoicesAdminService.getById(id);
    const result = await this.auditLogService.listForSupplierInvoice(id, limit ?? 20, offset ?? 0);

    return {
      items: result.items,
      total: result.total,
      limit: limit ?? 20,
      offset: offset ?? 0,
    };
  }

  @Post('supplier-invoices/parse-document')
  @RequireScopes('supplier_invoices:admin')
  @UseInterceptors(FileInterceptor('document'))
  async parseDocument(
    @UploadedFile() document: UploadedSupplierDocument,
  ): Promise<SupplierInvoiceParsePreviewResponseDto> {
    if (!document?.buffer) {
      return { lineItems: [], warnings: ['Document file is required'] };
    }

    return await this.eInvoiceInboundParseService.parseDocument(document.buffer, document.mimetype);
  }

  @Post('supplier-invoices')
  @RequireScopes('supplier_invoices:admin')
  @UseInterceptors(FileInterceptor('document'))
  async create(
    @Body() dto: CreateSupplierInvoiceDto,
    @UploadedFile() document: UploadedSupplierDocument | undefined,
    @Req() req: AdminRequest,
  ): Promise<SupplierInvoiceDetailResponseDto> {
    return await this.supplierInvoicesAdminService.createDraft(dto, req.user?.id ?? 'admin', document);
  }

  @Post('supplier-invoices/:id')
  @RequireScopes('supplier_invoices:admin')
  @UseInterceptors(FileInterceptor('document'))
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateSupplierInvoiceDto,
    @UploadedFile() document: UploadedSupplierDocument | undefined,
    @Req() req: AdminRequest,
  ): Promise<SupplierInvoiceDetailResponseDto> {
    return await this.supplierInvoicesAdminService.updateDraft(id, dto, req.user?.id ?? 'admin', document);
  }

  @Post('supplier-invoices/:id/issue')
  @RequireScopes('supplier_invoices:admin')
  async issue(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: IssueSupplierInvoiceDto,
    @Req() req: AdminRequest,
  ): Promise<SupplierInvoiceDetailResponseDto> {
    return await this.supplierInvoicesAdminService.issue(id, req.user?.id ?? 'admin', dto);
  }

  @Post('supplier-invoices/:id/void')
  @RequireScopes('supplier_invoices:admin')
  async voidInvoice(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: AdminRequest,
  ): Promise<SupplierInvoiceDetailResponseDto> {
    return await this.supplierInvoicesAdminService.void(id, req.user?.id ?? 'admin');
  }

  @Post('supplier-invoices/:id/mark-paid')
  @RequireScopes('supplier_invoices:admin')
  async markPaid(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: MarkSupplierInvoicePaymentStatusDto,
    @Req() req: AdminRequest,
  ): Promise<SupplierInvoiceDetailResponseDto> {
    return await this.supplierInvoicesAdminService.markPaid(id, req.user?.id ?? 'admin', dto);
  }

  @Post('supplier-invoices/:id/mark-unpaid')
  @RequireScopes('supplier_invoices:admin')
  async markUnpaid(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: MarkSupplierInvoicePaymentStatusDto,
    @Req() req: AdminRequest,
  ): Promise<SupplierInvoiceDetailResponseDto> {
    return await this.supplierInvoicesAdminService.markUnpaid(id, req.user?.id ?? 'admin', dto);
  }

  @Delete('supplier-invoices/:id')
  @RequireScopes('supplier_invoices:admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req: AdminRequest): Promise<void> {
    await this.supplierInvoicesAdminService.deleteDraft(id, req.user?.id ?? 'admin');
  }

  @Get('supplier-profiles/:supplierId/contracts')
  @RequireScopes('supplier_profile:admin')
  async searchContracts(
    @Param('supplierId', new ParseUUIDPipe({ version: '4' })) supplierId: string,
    @Query('search') search?: string,
  ): Promise<SupplierContractResponseDto[]> {
    return await this.supplierContractsService.searchBySupplier(supplierId, search);
  }

  @Post('supplier-profiles/:supplierId/contracts/get-or-create')
  @RequireScopes('supplier_profile:admin')
  async getOrCreateContract(
    @Param('supplierId', new ParseUUIDPipe({ version: '4' })) supplierId: string,
    @Body('contractNumber') contractNumber: string,
  ): Promise<SupplierContractResponseDto> {
    return await this.supplierContractsService.getOrCreateByNumber(supplierId, contractNumber);
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
