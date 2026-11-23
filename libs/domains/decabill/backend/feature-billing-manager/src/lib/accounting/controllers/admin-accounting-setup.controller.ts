import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { TenantsGlobalViewsConfigService } from '../../services/tenants-global-views-config.service';
import { getUserFromRequest, type RequestWithUser } from '../../utils/billing-access.utils';
import { decodeText } from '../bank-import/bank-parse.utils';
import {
  AccountDto,
  AccountingViewQueryDto,
  ChangeYearChartDto,
  CloseFiscalYearDto,
  CreateChartDto,
  FxRateDto,
  OpenFiscalYearDto,
  TaxCodeDto,
  UpdateAccountDto,
  UpdateTaxCodeDto,
} from '../dto/accounting.dto';
import { AccountingEnabledGuard } from '../guards/accounting-enabled.guard';
import { AccountingAdminService } from '../services/accounting-admin.service';
import { AccountingCatchUpService } from '../services/accounting-catch-up.service';
import { AccountingChartService } from '../services/accounting-chart.service';
import { AccountingClosingService } from '../services/accounting-closing.service';
import { AccountingFiscalYearService } from '../services/accounting-fiscal-year.service';
import { AccountingFxService } from '../services/accounting-fx.service';
import { assertGlobalAccounting, resolveAccountingScope } from '../utils/accounting-scope.util';

interface UploadedImportFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Accounting setup: overview, charts of accounts (templates, accounts, tax codes, imports), fiscal years, periods,
 * closing, exchange rates and posting issues. Entity-wide changes need a TENANTS_ALLOW_GLOBAL_VIEWS tenant.
 */
@Controller('admin/billing/accounting')
@UsersRoles(UserRole.ADMIN, UserRole.MANAGER)
@UseGuards(AccountingEnabledGuard)
export class AdminAccountingSetupController {
  constructor(
    private readonly globalViews: TenantsGlobalViewsConfigService,
    private readonly admin: AccountingAdminService,
    private readonly charts: AccountingChartService,
    private readonly fiscalYears: AccountingFiscalYearService,
    private readonly closing: AccountingClosingService,
    private readonly fx: AccountingFxService,
    private readonly catchUp: AccountingCatchUpService,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  @Get('overview')
  @RequireScopes('accounting_audit:admin')
  async overview(@Query() query: AccountingViewQueryDto) {
    return await this.admin.overview(resolveAccountingScope(this.globalViews, query.viewTenantId));
  }

  @Get('chart-templates')
  @RequireScopes('accounting_audit:admin')
  listTemplates() {
    return this.charts.listTemplates().map((t) => ({
      key: t.key,
      country: t.country,
      name: t.name,
      description: t.description,
      source: t.source,
      accountCount: t.accounts.length,
      taxCodeCount: t.taxCodes.length,
    }));
  }

  @Get('charts')
  @RequireScopes('accounting_audit:admin')
  async listCharts() {
    return await this.charts.listCharts();
  }

  @Post('charts')
  @RequireScopes('accounting:admin')
  async createChart(@Body() dto: CreateChartDto, @Req() req: RequestWithUser) {
    assertGlobalAccounting(this.globalViews);

    const chart = dto.templateKey
      ? await this.charts.createFromTemplate(dto.templateKey, { code: dto.code, name: dto.name })
      : await this.charts.createEmpty({
          code: dto.code ?? '',
          name: dto.name ?? dto.code ?? '',
          country: dto.country,
          accountLength: dto.accountLength,
        });

    await this.audit(req, 'accounting.chart.create', `Chart ${chart.code} created`, {
      chartId: chart.id,
      templateKey: dto.templateKey,
    });

    return chart;
  }

  @Get('charts/:chartId/accounts')
  @RequireScopes('accounting_audit:admin')
  async listAccounts(@Param('chartId', new ParseUUIDPipe({ version: '4' })) chartId: string) {
    return await this.charts.listAccounts(chartId);
  }

  @Post('charts/:chartId/accounts')
  @RequireScopes('accounting:admin')
  async createAccount(
    @Param('chartId', new ParseUUIDPipe({ version: '4' })) chartId: string,
    @Body() dto: AccountDto,
    @Req() req: RequestWithUser,
  ) {
    assertGlobalAccounting(this.globalViews);

    const account = await this.charts.createAccount(chartId, dto);

    await this.audit(req, 'accounting.account.create', `Account ${account.number} created`, { accountId: account.id });

    return account;
  }

  @Patch('accounts/:accountId')
  @RequireScopes('accounting:admin')
  async updateAccount(
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Body() dto: UpdateAccountDto,
    @Req() req: RequestWithUser,
  ) {
    assertGlobalAccounting(this.globalViews);

    const account = await this.charts.updateAccount(accountId, dto);

    await this.audit(req, 'accounting.account.update', `Account ${account.number} updated`, {
      accountId,
      changes: dto,
    });

    return account;
  }

  @Delete('accounts/:accountId')
  @RequireScopes('accounting:admin')
  async deleteAccount(
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Req() req: RequestWithUser,
  ) {
    assertGlobalAccounting(this.globalViews);
    await this.charts.deleteAccount(accountId);
    await this.audit(req, 'accounting.account.delete', 'Account deleted', { accountId });

    return { deleted: true };
  }

  /** CSV (`number;name[;type[;position]]`) or DATEV Kontenbeschriftungen (EXTF category 20). */
  @Post('charts/:chartId/accounts/import')
  @RequireScopes('accounting:admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async importAccounts(
    @Param('chartId', new ParseUUIDPipe({ version: '4' })) chartId: string,
    @UploadedFile() file: UploadedImportFile | undefined,
    @Req() req: RequestWithUser,
  ) {
    assertGlobalAccounting(this.globalViews);

    if (!file?.buffer?.length) {
      throw new BadRequestException('File is required');
    }

    const { text } = decodeText(file.buffer, 'auto');
    const rows = /^"?(EXTF|DTVF)"?;/.test(text)
      ? this.charts.parseDatevAccountLabels(text)
      : this.charts.parseAccountCsv(text);
    const result = await this.charts.importAccounts(chartId, rows);

    await this.audit(req, 'accounting.account.import', `Imported accounts into chart`, { chartId, ...result });

    return result;
  }

  @Get('charts/:chartId/tax-codes')
  @RequireScopes('accounting_audit:admin')
  async listTaxCodes(@Param('chartId', new ParseUUIDPipe({ version: '4' })) chartId: string) {
    return await this.charts.listTaxCodes(chartId);
  }

  @Post('charts/:chartId/tax-codes')
  @RequireScopes('accounting:admin')
  async createTaxCode(
    @Param('chartId', new ParseUUIDPipe({ version: '4' })) chartId: string,
    @Body() dto: TaxCodeDto,
    @Req() req: RequestWithUser,
  ) {
    assertGlobalAccounting(this.globalViews);

    const taxCode = await this.charts.createTaxCode(chartId, dto);

    await this.audit(req, 'accounting.tax_code.create', `Tax code ${taxCode.code} created`, { taxCodeId: taxCode.id });

    return taxCode;
  }

  @Patch('tax-codes/:taxCodeId')
  @RequireScopes('accounting:admin')
  async updateTaxCode(
    @Param('taxCodeId', new ParseUUIDPipe({ version: '4' })) taxCodeId: string,
    @Body() dto: UpdateTaxCodeDto,
    @Req() req: RequestWithUser,
  ) {
    assertGlobalAccounting(this.globalViews);

    const taxCode = await this.charts.updateTaxCode(taxCodeId, dto);

    await this.audit(req, 'accounting.tax_code.update', `Tax code ${taxCode.code} updated`, {
      taxCodeId,
      changes: dto,
    });

    return taxCode;
  }

  @Get('fiscal-years')
  @RequireScopes('accounting_audit:admin')
  async listYears() {
    const years = await this.fiscalYears.listYears();

    return await Promise.all(years.map(async (y) => ({ ...y, periods: await this.fiscalYears.listPeriods(y.id) })));
  }

  @Post('fiscal-years')
  @RequireScopes('accounting:admin')
  async openNextYear(@Body() dto: OpenFiscalYearDto, @Req() req: RequestWithUser) {
    assertGlobalAccounting(this.globalViews);

    const year = await this.fiscalYears.openNextYear(dto);

    await this.audit(req, 'accounting.fiscal_year.open', `Fiscal year ${year.name} opened`, {
      fiscalYearId: year.id,
      chartId: year.chartId,
    });

    return year;
  }

  @Patch('fiscal-years/:id/chart')
  @RequireScopes('accounting:admin')
  async changeChart(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ChangeYearChartDto,
    @Req() req: RequestWithUser,
  ) {
    assertGlobalAccounting(this.globalViews);

    const year = await this.fiscalYears.changeChartOfEmptyYear(id, dto.chartId);

    await this.audit(req, 'accounting.fiscal_year.chart', `Chart of fiscal year ${year.name} changed`, {
      fiscalYearId: id,
      chartId: dto.chartId,
    });

    return year;
  }

  @Post('periods/:id/lock')
  @RequireScopes('accounting:admin')
  async lockPeriod(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req: RequestWithUser) {
    assertGlobalAccounting(this.globalViews);

    const userId = getUserFromRequest(req).userId ?? null;
    const period = await this.fiscalYears.lockPeriod(id, userId);

    await this.audit(req, 'accounting.period.lock', `Period ${period.startDate} – ${period.endDate} locked`, {
      periodId: id,
    });

    return period;
  }

  @Post('fiscal-years/:id/close/preview')
  @RequireScopes('accounting:admin')
  async closePreview(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: CloseFiscalYearDto) {
    assertGlobalAccounting(this.globalViews);

    return await this.closing.preview(id, dto);
  }

  @Post('fiscal-years/:id/close')
  @RequireScopes('accounting:admin')
  async close(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CloseFiscalYearDto,
    @Req() req: RequestWithUser,
  ) {
    assertGlobalAccounting(this.globalViews);

    const year = await this.closing.close(id, dto, getUserFromRequest(req).userId ?? null);

    await this.audit(req, 'accounting.fiscal_year.close', `Fiscal year ${year.name} closed`, {
      fiscalYearId: id,
      nextChartId: dto.nextChartId,
    });

    return year;
  }

  @Get('fx-rates')
  @RequireScopes('accounting_audit:admin')
  async listRates(
    @Query('currency') currency?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 100,
    @Query('offset', new ParseIntPipe({ optional: true })) offset = 0,
  ) {
    return await this.fx.listRates({ currency, from, to, limit: Math.min(limit, 500), offset });
  }

  @Post('fx-rates')
  @RequireScopes('accounting:admin')
  async setRate(@Body() dto: FxRateDto, @Req() req: RequestWithUser) {
    assertGlobalAccounting(this.globalViews);

    const rate = await this.fx.setManualRate(
      dto.currency,
      dto.rateDate,
      dto.rate,
      getUserFromRequest(req).userId ?? null,
    );

    await this.audit(req, 'accounting.fx_rate.set', `Manual rate ${dto.currency} ${dto.rateDate}`, { ...dto });

    return rate;
  }

  @Post('fx-rates/fetch')
  @RequireScopes('accounting:admin')
  async fetchRates() {
    assertGlobalAccounting(this.globalViews);

    return { stored: await this.fx.fetchEcbRates() };
  }

  @Get('posting-issues')
  @RequireScopes('accounting_audit:admin')
  async listIssues(
    @Query('includeResolved') includeResolved?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('offset', new ParseIntPipe({ optional: true })) offset = 0,
  ) {
    assertGlobalAccounting(this.globalViews);

    return await this.admin.listPostingIssues(includeResolved === 'true', Math.min(limit, 200), offset);
  }

  /** Runs the catch-up (backfill + retry of failed postings) now. */
  @Post('catch-up')
  @RequireScopes('accounting:admin')
  async runCatchUp(@Req() req: RequestWithUser) {
    assertGlobalAccounting(this.globalViews);

    const result = await this.catchUp.run();

    await this.audit(req, 'accounting.catch_up', 'Accounting catch-up run', { ...(result ?? {}) });

    return result ?? { skipped: true };
  }

  private async audit(
    req: RequestWithUser,
    process: string,
    message: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLog.log({
      process,
      level: 'info',
      message,
      userId: getUserFromRequest(req).userId ?? undefined,
      context,
    });
  }
}
