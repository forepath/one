import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { TenantsGlobalViewsConfigService } from '../../services/tenants-global-views-config.service';
import { getUserFromRequest, type RequestWithUser } from '../../utils/billing-access.utils';
import { CounterpartyType, JOURNAL_LINK_TYPES, JournalLinkType } from '../constants/accounting.constants';
import {
  AccountingDateRangeQueryDto,
  AccountLedgerQueryDto,
  AccountingExportQueryDto,
  JournalLinkDto,
  JournalListQueryDto,
  ManualEntryDto,
  OpenItemsQueryDto,
  ReverseEntryDto,
  StatementQueryDto,
} from '../dto/accounting.dto';
import { AccountingExportService } from '../exports/accounting-export.service';
import { AccountingEnabledGuard } from '../guards/accounting-enabled.guard';
import { AccountingAdminService } from '../services/accounting-admin.service';
import { AccountingJournalService } from '../services/accounting-journal.service';
import { AccountingReferenceService } from '../services/accounting-reference.service';
import { AccountingReportsService } from '../services/accounting-reports.service';
import { isoToday } from '../utils/accounting-date.util';
import { resolveAccountingScope } from '../utils/accounting-scope.util';
import { attachmentDisposition } from '../utils/content-disposition.util';

interface UploadedReceipt {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Journal, manual bookings, links / receipts, account ledgers, trial balance, open items, statements, statistics
 * and ledger exports. Tenant-scoped by default; `viewTenantId` (another tenant or `all`) needs global views.
 */
@Controller('admin/billing/accounting')
@UsersRoles(UserRole.ADMIN)
@UseGuards(AccountingEnabledGuard)
export class AdminAccountingJournalController {
  constructor(
    private readonly globalViews: TenantsGlobalViewsConfigService,
    private readonly admin: AccountingAdminService,
    private readonly journal: AccountingJournalService,
    private readonly reports: AccountingReportsService,
    private readonly exports: AccountingExportService,
    private readonly references: AccountingReferenceService,
  ) {}

  @Get('journal')
  @RequireScopes('accounting_audit:admin')
  async listJournal(@Query() q: JournalListQueryDto) {
    return await this.admin.listJournal(resolveAccountingScope(this.globalViews, q.viewTenantId), {
      ...q,
      limit: q.limit ?? 50,
      offset: q.offset ?? 0,
    });
  }

  @Get('journal/statistics')
  @RequireScopes('accounting_audit:admin')
  async journalStatistics(@Query() q: AccountingDateRangeQueryDto) {
    return await this.admin.journalStatistics(resolveAccountingScope(this.globalViews, q.viewTenantId), q.from, q.to);
  }

  /** Display label of a linked document (e.g. the invoice number of the journal's "bookings of" filter). */
  @Get('journal/reference-label')
  @RequireScopes('accounting_audit:admin')
  async referenceLabel(
    @Query('linkType') linkType: string,
    @Query('targetId') targetId: string,
    @Query('viewTenantId') viewTenantId?: string,
  ) {
    if (!JOURNAL_LINK_TYPES.includes(linkType as JournalLinkType) || !targetId || targetId.length > 64) {
      throw new BadRequestException('linkType and targetId are required');
    }

    const scope = resolveAccountingScope(this.globalViews, viewTenantId);

    return { label: await this.references.label(linkType, targetId, scope.tenantFilter) };
  }

  /** Bookings linked to a document or transaction (reverse lookup from invoices, bank lines, assets …). */
  @Get('journal/by-link')
  @RequireScopes('accounting_audit:admin')
  async byLink(
    @Query('linkType') linkType: string,
    @Query('targetId') targetId: string,
    @Query('viewTenantId') viewTenantId?: string,
  ) {
    if (!JOURNAL_LINK_TYPES.includes(linkType as JournalLinkType) || !targetId || targetId.length > 64) {
      throw new BadRequestException('linkType and targetId are required');
    }

    const scope = resolveAccountingScope(this.globalViews, viewTenantId);
    const entries = await this.journal.findEntriesByLink(linkType as JournalLinkType, targetId);

    return entries.filter((e) => scope.tenantFilter === null || e.tenantId === scope.tenantFilter);
  }

  @Get('journal/:entryId')
  @RequireScopes('accounting_audit:admin')
  async getEntry(
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @Query('viewTenantId') viewTenantId?: string,
  ) {
    return await this.admin.getEntry(entryId, resolveAccountingScope(this.globalViews, viewTenantId));
  }

  @Post('journal')
  @RequireScopes('accounting:admin')
  async createEntry(
    @Body() dto: ManualEntryDto,
    @Req() req: RequestWithUser,
    @Query('viewTenantId') viewTenantId?: string,
  ) {
    return await this.admin.createManualEntry(
      dto,
      resolveAccountingScope(this.globalViews, viewTenantId),
      getUserFromRequest(req).userId ?? null,
    );
  }

  @Post('journal/:entryId/reverse')
  @RequireScopes('accounting:admin')
  async reverse(
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @Body() dto: ReverseEntryDto,
    @Req() req: RequestWithUser,
    @Query('viewTenantId') viewTenantId?: string,
  ) {
    return await this.admin.reverseEntry(
      entryId,
      dto,
      resolveAccountingScope(this.globalViews, viewTenantId),
      getUserFromRequest(req).userId ?? null,
    );
  }

  @Post('journal/:entryId/links')
  @RequireScopes('accounting:admin')
  async addLink(
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @Body() dto: JournalLinkDto,
    @Req() req: RequestWithUser,
    @Query('viewTenantId') viewTenantId?: string,
  ) {
    return await this.admin.addLink(
      entryId,
      dto,
      resolveAccountingScope(this.globalViews, viewTenantId),
      getUserFromRequest(req).userId ?? null,
    );
  }

  @Delete('journal/:entryId/links/:linkId')
  @RequireScopes('accounting:admin')
  async removeLink(
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @Param('linkId', new ParseUUIDPipe({ version: '4' })) linkId: string,
    @Req() req: RequestWithUser,
    @Query('viewTenantId') viewTenantId?: string,
  ) {
    await this.admin.removeLink(
      entryId,
      linkId,
      resolveAccountingScope(this.globalViews, viewTenantId),
      getUserFromRequest(req).userId ?? null,
    );

    return { removed: true };
  }

  @Post('journal/:entryId/receipts')
  @RequireScopes('accounting:admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  async attachReceipt(
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @UploadedFile() file: UploadedReceipt | undefined,
    @Req() req: RequestWithUser,
    @Query('viewTenantId') viewTenantId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return await this.admin.attachReceipt(
      entryId,
      file,
      resolveAccountingScope(this.globalViews, viewTenantId),
      getUserFromRequest(req).userId ?? null,
    );
  }

  @Get('receipts/:storedFileId')
  @RequireScopes('accounting_audit:admin')
  async downloadReceipt(
    @Param('storedFileId', new ParseUUIDPipe({ version: '4' })) storedFileId: string,
    @Query('viewTenantId') viewTenantId?: string,
  ) {
    const { buffer, fileName } = await this.admin.downloadReceipt(
      storedFileId,
      resolveAccountingScope(this.globalViews, viewTenantId),
    );

    return new StreamableFile(buffer, {
      type: 'application/octet-stream',
      disposition: attachmentDisposition(fileName),
    });
  }

  @Get('accounts/:accountId/ledger')
  @RequireScopes('accounting_audit:admin')
  async ledger(
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Query() q: AccountLedgerQueryDto,
  ) {
    const scope = resolveAccountingScope(this.globalViews, q.viewTenantId);

    return await this.reports.accountLedger(accountId, q.from, q.to, scope.tenantFilter, q.limit ?? 100, q.offset ?? 0);
  }

  @Get('trial-balance')
  @RequireScopes('accounting_audit:admin')
  async trialBalance(@Query() q: AccountingDateRangeQueryDto) {
    const scope = resolveAccountingScope(this.globalViews, q.viewTenantId);

    return await this.reports.trialBalance(q.from, q.to, scope.tenantFilter);
  }

  @Get('open-items')
  @RequireScopes('accounting_audit:admin')
  async openItems(@Query() q: OpenItemsQueryDto) {
    const scope = resolveAccountingScope(this.globalViews, q.viewTenantId);
    const result = await this.reports.openItems(q.type as CounterpartyType, q.asOf ?? isoToday(), scope.tenantFilter);
    const labels = await this.references.labels(
      result.items.map((row) => ({ type: q.type, id: row.counterpartyId })),
      undefined,
      scope.tenantFilter,
    );

    return {
      ...result,
      items: result.items.map((row) => ({
        ...row,
        counterpartyLabel: row.counterpartyId
          ? (labels.get(AccountingReferenceService.key(q.type, row.counterpartyId)) ?? null)
          : null,
      })),
    };
  }

  /** Balance sheet / P&L / cash-basis statement (tenant-filtered views are management reports, `all` = statutory). */
  @Get('statements')
  @RequireScopes('accounting_audit:admin')
  async statement(@Query() q: StatementQueryDto) {
    const scope = resolveAccountingScope(this.globalViews, q.viewTenantId);

    if (q.kind === 'balance_sheet') {
      return await this.reports.balanceSheet(q.to, scope.tenantFilter);
    }

    if (q.kind === 'profit_and_loss') {
      return await this.reports.profitAndLoss(q.from, q.to, scope.tenantFilter);
    }

    return await this.reports.cashBasis(q.from, q.to, scope.tenantFilter);
  }

  @Get('exports')
  @RequireScopes('accounting_audit:admin')
  async export(@Query() q: AccountingExportQueryDto): Promise<StreamableFile> {
    const scope = resolveAccountingScope(this.globalViews, q.viewTenantId);

    // Statutory exports always cover the whole entity (global views only).
    if (['gdpdu', 'fec', 'saft', 'xaf'].includes(q.kind) && scope.tenantFilter !== null) {
      throw new BadRequestException('Statutory exports cover all tenants; use viewTenantId=all');
    }

    const file = await this.exports.export(q.kind, q.from, q.to, scope.tenantFilter);

    return new StreamableFile(file.content, {
      type: file.contentType,
      disposition: attachmentDisposition(file.fileName),
    });
  }
}
