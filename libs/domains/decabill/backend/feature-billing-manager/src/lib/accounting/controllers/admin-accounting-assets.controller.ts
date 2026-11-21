import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';

import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { TenantsGlobalViewsConfigService } from '../../services/tenants-global-views-config.service';
import { getUserFromRequest, type RequestWithUser } from '../../utils/billing-access.utils';
import {
  AccountingDateRangeQueryDto,
  CreateAssetDto,
  DepreciationRunDto,
  DisposeAssetDto,
} from '../dto/accounting.dto';
import { AccountingEnabledGuard } from '../guards/accounting-enabled.guard';
import { AccountingFixedAssetService } from '../services/accounting-fixed-asset.service';
import { assertGlobalAccounting } from '../utils/accounting-scope.util';

/** Fixed asset register, depreciation runs, disposals and the asset schedule (entity-wide: global views). */
@Controller('admin/billing/accounting/assets')
@UsersRoles(UserRole.ADMIN)
@UseGuards(AccountingEnabledGuard)
export class AdminAccountingAssetsController {
  constructor(
    private readonly globalViews: TenantsGlobalViewsConfigService,
    private readonly assets: AccountingFixedAssetService,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  @Get()
  @RequireScopes('accounting_audit:admin')
  async list(
    @Query('status') status?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
    @Query('offset', new ParseIntPipe({ optional: true })) offset = 0,
    @Query('search') search?: string,
  ) {
    assertGlobalAccounting(this.globalViews);

    return await this.assets.list({
      status,
      limit: Math.min(Math.max(limit, 1), 200),
      offset: Math.max(offset, 0),
      search: search?.trim().slice(0, 100) || undefined,
    });
  }

  @Get('schedule')
  @RequireScopes('accounting_audit:admin')
  async schedule(@Query() q: AccountingDateRangeQueryDto) {
    assertGlobalAccounting(this.globalViews);

    return await this.assets.schedule(q.from, q.to);
  }

  @Get(':id')
  @RequireScopes('accounting_audit:admin')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    assertGlobalAccounting(this.globalViews);

    const asset = await this.assets.get(id);

    return { ...asset, plan: this.assets.plannedDepreciation(asset, `${new Date().getUTCFullYear() + 50}-12`) };
  }

  @Post()
  @RequireScopes('accounting:admin')
  async create(@Body() dto: CreateAssetDto, @Req() req: RequestWithUser) {
    const scope = assertGlobalAccounting(this.globalViews);
    const asset = await this.assets.create({ ...dto, tenantId: scope.requestTenantId });

    await this.auditLog.log({
      process: 'accounting.asset.create',
      level: 'info',
      message: `Asset ${asset.assetNumber} created`,
      userId: getUserFromRequest(req).userId ?? undefined,
      context: { assetId: asset.id },
    });

    return asset;
  }

  @Post('depreciation-run')
  @RequireScopes('accounting:admin')
  async depreciate(@Body() dto: DepreciationRunDto, @Req() req: RequestWithUser) {
    assertGlobalAccounting(this.globalViews);

    const userId = getUserFromRequest(req).userId ?? null;
    const result = await this.assets.runDepreciation(dto.through, userId);

    await this.auditLog.log({
      process: 'accounting.asset.depreciation',
      level: 'info',
      message: `Depreciation run through ${dto.through}`,
      userId: userId ?? undefined,
      context: result,
    });

    return result;
  }

  @Post(':id/dispose')
  @RequireScopes('accounting:admin')
  async dispose(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: DisposeAssetDto,
    @Req() req: RequestWithUser,
  ) {
    assertGlobalAccounting(this.globalViews);

    const userId = getUserFromRequest(req).userId ?? null;
    const asset = await this.assets.dispose(id, dto, userId);

    await this.auditLog.log({
      process: 'accounting.asset.dispose',
      level: 'info',
      message: `Asset ${asset.assetNumber} disposed`,
      userId: userId ?? undefined,
      context: { assetId: id, date: dto.date },
    });

    return asset;
  }
}
