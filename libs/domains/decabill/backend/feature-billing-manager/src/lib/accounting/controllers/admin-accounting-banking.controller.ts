import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { TenantsGlobalViewsConfigService } from '../../services/tenants-global-views-config.service';
import { getUserFromRequest, type RequestWithUser } from '../../utils/billing-access.utils';
import {
  AccountingDateRangeQueryDto,
  AccountingPageQueryDto,
  AccountingViewQueryDto,
  BankImportUploadDto,
  BankTransactionQueryDto,
  CsvMappingDto,
  FinancialAccountDto,
  MatchBankTransactionDto,
  MatchRuleDto,
} from '../dto/accounting.dto';
import { AccountingEnabledGuard } from '../guards/accounting-enabled.guard';
import { AccountingAdminService } from '../services/accounting-admin.service';
import { AccountingBankImportService } from '../services/accounting-bank-import.service';
import { AccountingProcessorSyncService } from '../services/accounting-processor-sync.service';
import { AccountingReconciliationService, type MatchTarget } from '../services/accounting-reconciliation.service';
import { AccountingReferenceService } from '../services/accounting-reference.service';
import { assertGlobalAccounting, resolveAccountingScope } from '../utils/accounting-scope.util';
import { attachmentDisposition } from '../utils/content-disposition.util';

interface UploadedStatement {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/** Hard multipart cap; the configured BILLING_ACCOUNTING_BANK_IMPORT_MAX_BYTES (≤ 200 MB) is enforced in the service. */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/**
 * Banking: financial accounts, statement file imports (all supported formats / CSV presets / saved mappings),
 * transactions, reconciliation, match rules and processor sync. Tenant-owned accounts are visible to their tenant;
 * shared accounts and other tenants need global views.
 */
@Controller('admin/billing/accounting/banking')
@UsersRoles(UserRole.ADMIN)
@UseGuards(AccountingEnabledGuard)
export class AdminAccountingBankingController {
  constructor(
    private readonly globalViews: TenantsGlobalViewsConfigService,
    private readonly admin: AccountingAdminService,
    private readonly imports: AccountingBankImportService,
    private readonly reconciliation: AccountingReconciliationService,
    private readonly processorSync: AccountingProcessorSyncService,
    private readonly auditLog: BillingAuditLogService,
    private readonly references: AccountingReferenceService,
  ) {}

  @Get('accounts')
  @RequireScopes('accounting_audit:admin')
  async listAccounts(@Query() q: AccountingViewQueryDto) {
    return await this.admin.listFinancialAccounts(resolveAccountingScope(this.globalViews, q.viewTenantId));
  }

  @Post('accounts')
  @RequireScopes('accounting:admin')
  async createAccount(@Body() dto: FinancialAccountDto, @Req() req: RequestWithUser) {
    return await this.admin.saveFinancialAccount(
      null,
      dto,
      resolveAccountingScope(this.globalViews),
      getUserFromRequest(req).userId ?? null,
    );
  }

  @Patch('accounts/:id')
  @RequireScopes('accounting:admin')
  async updateAccount(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: FinancialAccountDto,
    @Req() req: RequestWithUser,
  ) {
    return await this.admin.saveFinancialAccount(
      id,
      dto,
      resolveAccountingScope(this.globalViews),
      getUserFromRequest(req).userId ?? null,
    );
  }

  @Get('csv-presets')
  @RequireScopes('accounting_audit:admin')
  csvPresets() {
    return this.imports.csvPresets();
  }

  @Get('csv-mappings')
  @RequireScopes('accounting_audit:admin')
  async listMappings() {
    return await this.admin.listCsvMappings(resolveAccountingScope(this.globalViews));
  }

  @Post('csv-mappings')
  @RequireScopes('accounting:admin')
  async createMapping(@Body() dto: CsvMappingDto) {
    return await this.admin.saveCsvMapping(null, dto, resolveAccountingScope(this.globalViews));
  }

  @Patch('csv-mappings/:id')
  @RequireScopes('accounting:admin')
  async updateMapping(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: CsvMappingDto) {
    return await this.admin.saveCsvMapping(id, dto, resolveAccountingScope(this.globalViews));
  }

  @Delete('csv-mappings/:id')
  @RequireScopes('accounting:admin')
  async deleteMapping(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.admin.deleteCsvMapping(id, resolveAccountingScope(this.globalViews));

    return { deleted: true };
  }

  @Get('imports')
  @RequireScopes('accounting_audit:admin')
  async listImports(@Query() q: AccountingPageQueryDto) {
    return await this.admin.listImports(
      resolveAccountingScope(this.globalViews, q.viewTenantId),
      q.limit ?? 20,
      q.offset ?? 0,
    );
  }

  @Post('imports')
  @RequireScopes('accounting:admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 20 } }))
  async upload(
    @UploadedFile() file: UploadedStatement | undefined,
    @Body() dto: BankImportUploadDto,
    @Req() req: RequestWithUser,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const scope = resolveAccountingScope(this.globalViews);
    const userId = getUserFromRequest(req).userId ?? null;
    const result = await this.imports.upload(
      file,
      dto,
      { tenantId: scope.requestTenantId, global: scope.global },
      userId,
    );

    await this.auditLog.log({
      process: 'accounting.bank_import',
      level: result.status === 'failed' ? 'warn' : 'info',
      message: `Statement import ${result.fileName}: ${result.status}`,
      userId: userId ?? undefined,
      context: {
        importId: result.id,
        transactions: result.transactionCount,
        duplicates: result.duplicateCount,
        error: result.errorMessage,
      },
    });

    return result;
  }

  @Get('imports/:id')
  @RequireScopes('accounting_audit:admin')
  async getImport(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const scope = resolveAccountingScope(this.globalViews);

    return await this.imports.getImport(id, { tenantId: scope.requestTenantId, global: scope.global });
  }

  @Get('imports/:id/file')
  @RequireScopes('accounting_audit:admin')
  async downloadImport(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<StreamableFile> {
    const scope = resolveAccountingScope(this.globalViews);
    const { buffer, fileName } = await this.imports.downloadImportFile(id, {
      tenantId: scope.requestTenantId,
      global: scope.global,
    });

    return new StreamableFile(buffer, {
      type: 'application/octet-stream',
      disposition: attachmentDisposition(fileName),
    });
  }

  @Post('imports/:id/rollback')
  @RequireScopes('accounting:admin')
  async rollback(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req: RequestWithUser) {
    const scope = resolveAccountingScope(this.globalViews);
    const result = await this.imports.rollback(id, { tenantId: scope.requestTenantId, global: scope.global });

    await this.auditLog.log({
      process: 'accounting.bank_import.rollback',
      level: 'info',
      message: `Statement import ${result.fileName} rolled back`,
      userId: getUserFromRequest(req).userId ?? undefined,
      context: { importId: id },
    });

    return result;
  }

  @Get('transactions')
  @RequireScopes('accounting_audit:admin')
  async listTransactions(@Query() q: BankTransactionQueryDto) {
    return await this.admin.listTransactions(resolveAccountingScope(this.globalViews, q.viewTenantId), {
      ...q,
      limit: q.limit ?? 50,
      offset: q.offset ?? 0,
    });
  }

  @Get('statistics')
  @RequireScopes('accounting_audit:admin')
  async statistics(@Query() q: AccountingDateRangeQueryDto) {
    return await this.admin.bankStatistics(resolveAccountingScope(this.globalViews, q.viewTenantId), q.from, q.to);
  }

  @Get('transactions/:id/suggestions')
  @RequireScopes('accounting_audit:admin')
  async suggestions(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.admin.suggestionsFor(id, resolveAccountingScope(this.globalViews));
  }

  @Post('transactions/:id/match')
  @RequireScopes('accounting:admin')
  async match(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: MatchBankTransactionDto,
    @Req() req: RequestWithUser,
  ) {
    const scope = resolveAccountingScope(this.globalViews);
    const tx = await this.admin.getTransactionForScope(id, scope);
    const targets: MatchTarget[] = [];

    for (const t of dto.targets) {
      if (t.type === 'account') {
        if (!t.accountNumber) {
          throw new BadRequestException('Account targets need an account number');
        }

        targets.push({
          type: 'account',
          accountNumber: t.accountNumber,
          amount: t.amount,
          taxCode: t.taxCode ?? null,
          description: t.description ?? null,
        });
        continue;
      }

      const reference = t.id ?? t.number;

      if (!reference) {
        throw new BadRequestException('Document targets need a document number');
      }

      // People enter the invoice number; ids (suggestions) pass through. Numbers resolve within the account's tenant.
      targets.push({
        type: t.type,
        id: await this.references.resolve(t.type, reference, tx.tenantId ?? null),
        amount: t.amount,
      });
    }

    const userId = getUserFromRequest(req).userId ?? null;
    const result = await this.reconciliation.apply(id, targets, userId, {
      // Learned rules are entity-wide (they steer suggestions and auto-matching for every tenant), so only global views may create them.
      learn: scope.global ? (dto.learn ?? false) : false,
    });

    await this.auditLog.log({
      process: 'accounting.bank_transaction.match',
      level: 'info',
      message: 'Bank transaction reconciled',
      userId: userId ?? undefined,
      context: { transactionId: id, targets: dto.targets, learn: dto.learn },
    });

    return result;
  }

  @Post('transactions/:id/unmatch')
  @RequireScopes('accounting:admin')
  async unmatch(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req: RequestWithUser) {
    await this.admin.getTransactionForScope(id, resolveAccountingScope(this.globalViews));

    const userId = getUserFromRequest(req).userId ?? null;
    const result = await this.reconciliation.unmatch(id, userId);

    await this.auditLog.log({
      process: 'accounting.bank_transaction.unmatch',
      level: 'info',
      message: 'Bank reconciliation undone',
      userId: userId ?? undefined,
      context: { transactionId: id },
    });

    return result;
  }

  @Post('transactions/:id/ignore')
  @RequireScopes('accounting:admin')
  async ignore(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req: RequestWithUser) {
    await this.admin.getTransactionForScope(id, resolveAccountingScope(this.globalViews));
    await this.reconciliation.ignore(id, getUserFromRequest(req).userId ?? null);

    return { ignored: true };
  }

  @Get('rules')
  @RequireScopes('accounting_audit:admin')
  async rules() {
    assertGlobalAccounting(this.globalViews);

    const rules = await this.reconciliation.listRules();
    const labels = await this.references.labels(rules.map((r) => ({ type: r.targetType, id: r.targetId })));

    return rules.map((r) => ({
      ...r,
      targetLabel:
        r.targetType === 'account'
          ? r.targetId
          : (labels.get(AccountingReferenceService.key(r.targetType, r.targetId)) ?? null),
    }));
  }

  @Post('rules')
  @RequireScopes('accounting:admin')
  async createRule(@Body() dto: MatchRuleDto, @Req() req: RequestWithUser) {
    assertGlobalAccounting(this.globalViews);

    // Customers / suppliers are entered by their number (rules are entity-wide, so no tenant narrows the lookup).
    const targetId =
      dto.targetType === 'account' ? dto.targetId : await this.references.resolve(dto.targetType, dto.targetId, null);

    return await this.reconciliation.createRule({ ...dto, targetId }, getUserFromRequest(req).userId ?? null);
  }

  @Delete('rules/:id')
  @RequireScopes('accounting:admin')
  async deleteRule(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    assertGlobalAccounting(this.globalViews);
    await this.reconciliation.deleteRule(id);

    return { deleted: true };
  }

  /** Processor API sync (fees, payouts) now; also runs on a schedule. */
  @Post('processor-sync')
  @RequireScopes('accounting:admin')
  async sync(@Req() req: RequestWithUser) {
    assertGlobalAccounting(this.globalViews);

    const result = await this.processorSync.syncAll();

    await this.auditLog.log({
      process: 'accounting.processor_sync',
      level: 'info',
      message: 'Processor sync run',
      userId: getUserFromRequest(req).userId ?? undefined,
      context: { result },
    });

    return result;
  }
}
