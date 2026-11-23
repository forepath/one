import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';

import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { TenantsGlobalViewsConfigService } from '../../services/tenants-global-views-config.service';
import { getUserFromRequest, type RequestWithUser } from '../../utils/billing-access.utils';
import { neutralizeCsvCell } from '../bank-import/parsers/csv-injection.util';
import { ComputeVatReturnDto, PayVatReturnDto, SubmitVatReturnDto } from '../dto/accounting.dto';
import { AccountingEnabledGuard } from '../guards/accounting-enabled.guard';
import { AccountingVatReturnService } from '../services/accounting-vat-return.service';
import { assertGlobalAccounting } from '../utils/accounting-scope.util';

/** VAT returns of the active country profile (computed for manual filing). Entity-wide: global views only. */
@Controller('admin/billing/accounting/vat-returns')
@UsersRoles(UserRole.ADMIN, UserRole.MANAGER)
@UseGuards(AccountingEnabledGuard)
export class AdminAccountingVatController {
  constructor(
    private readonly globalViews: TenantsGlobalViewsConfigService,
    private readonly vatReturns: AccountingVatReturnService,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  @Get('definitions')
  @RequireScopes('accounting_audit:admin')
  definitions() {
    assertGlobalAccounting(this.globalViews);

    return this.vatReturns.definitions();
  }

  @Get()
  @RequireScopes('accounting_audit:admin')
  async list(
    @Query('definitionKey') definitionKey?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('offset', new ParseIntPipe({ optional: true })) offset = 0,
  ) {
    assertGlobalAccounting(this.globalViews);

    return await this.vatReturns.list(definitionKey, Math.min(limit, 200), offset);
  }

  @Get('statistics')
  @RequireScopes('accounting_audit:admin')
  async statistics() {
    assertGlobalAccounting(this.globalViews);

    const { items } = await this.vatReturns.list(undefined, 200, 0);
    const periodic = items
      .filter((r) => r.resultAmount != null)
      .sort((a, b) => a.periodStart.localeCompare(b.periodStart));

    return {
      kpis: {
        returns: items.length,
        drafts: items.filter((r) => r.status === 'draft').length,
        submitted: items.filter((r) => r.status === 'submitted').length,
        paid: items.filter((r) => r.status === 'paid').length,
        payableTotal: periodic.reduce((s, r) => s + Math.max(0, Number(r.resultAmount)), 0),
      },
      series: periodic.map((r) => ({
        key: r.definitionKey,
        period: r.periodStart,
        result: Number(r.resultAmount),
        status: r.status,
      })),
    };
  }

  @Get(':id')
  @RequireScopes('accounting_audit:admin')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    assertGlobalAccounting(this.globalViews);

    return await this.vatReturns.get(id);
  }

  @Get(':id/csv')
  @RequireScopes('accounting_audit:admin')
  async csv(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<StreamableFile> {
    assertGlobalAccounting(this.globalViews);

    const row = await this.vatReturns.get(id);
    const def = this.vatReturns.definition(row.definitionKey);
    const lines = ['box;label;amount'];

    for (const box of def.boxes) {
      lines.push(
        [box.box, neutralizeCsvCell(box.label), String(row.figures[box.box] ?? 0).replace('.', ',')]
          .map((v) => `"${v.replace(/"/g, '""')}"`)
          .join(';'),
      );
    }

    for (const detail of row.details ?? []) {
      lines.push(
        Object.values(detail)
          .map((v) => `"${neutralizeCsvCell(String(v)).replace(/"/g, '""')}"`)
          .join(';'),
      );
    }

    return new StreamableFile(Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${row.definitionKey}_${row.periodStart}_${row.periodEnd}.csv"`,
    });
  }

  @Post('compute')
  @RequireScopes('accounting:admin')
  async compute(@Body() dto: ComputeVatReturnDto, @Req() req: RequestWithUser) {
    assertGlobalAccounting(this.globalViews);

    const row = await this.vatReturns.compute(dto);

    await this.auditLog.log({
      process: 'accounting.vat_return.compute',
      level: 'info',
      message: `VAT return ${dto.definitionKey} ${dto.periodStart} – ${dto.periodEnd} computed`,
      userId: getUserFromRequest(req).userId ?? undefined,
      context: { vatReturnId: row.id, result: row.resultAmount },
    });

    return row;
  }

  @Post(':id/submit')
  @RequireScopes('accounting:admin')
  async submit(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SubmitVatReturnDto,
    @Req() req: RequestWithUser,
  ) {
    assertGlobalAccounting(this.globalViews);

    const userId = getUserFromRequest(req).userId ?? null;
    const row = await this.vatReturns.submit(id, dto, userId);

    await this.auditLog.log({
      process: 'accounting.vat_return.submit',
      level: 'info',
      message: `VAT return ${row.definitionKey} ${row.periodStart} – ${row.periodEnd} submitted; periods locked`,
      userId: userId ?? undefined,
      context: { vatReturnId: id, filingReference: dto.filingReference },
    });

    return row;
  }

  @Post(':id/payment')
  @RequireScopes('accounting:admin')
  async pay(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: PayVatReturnDto,
    @Req() req: RequestWithUser,
  ) {
    assertGlobalAccounting(this.globalViews);

    const userId = getUserFromRequest(req).userId ?? null;
    const row = await this.vatReturns.recordPayment(id, dto, userId);

    await this.auditLog.log({
      process: 'accounting.vat_return.payment',
      level: 'info',
      message: `VAT return ${row.definitionKey} payment booked`,
      userId: userId ?? undefined,
      context: { vatReturnId: id, amount: dto.amount, date: dto.date },
    });

    return row;
  }
}
