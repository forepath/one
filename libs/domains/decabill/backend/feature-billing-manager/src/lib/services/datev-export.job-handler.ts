import { DEFAULT_TENANT, runWithTenantId } from '@forepath/shared/backend';
import { Injectable, Logger } from '@nestjs/common';

import { DatevExportScope, DatevExportStatus } from '../constants/datev-export.constants';
import type { DatevExportUnitPayload } from '../queue/datev-export.payload';
import { DatevExportRepository } from '../repositories/datev-export.repository';
import { resolvePreviousCalendarMonth } from '../utils/datev-format.util';
import { BillingAuditLogService } from './billing-audit-log.service';
import { DatevExportConfigService } from './datev-export-config.service';
import { DatevExportService } from './datev-export.service';

@Injectable()
export class DatevExportJobHandler {
  private readonly logger = new Logger(DatevExportJobHandler.name);

  constructor(
    private readonly configService: DatevExportConfigService,
    private readonly exportRepository: DatevExportRepository,
    private readonly exportService: DatevExportService,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  resolvePreviousMonth(reference = new Date()): { year: number; month: number; periodStart: Date; periodEnd: Date } {
    return resolvePreviousCalendarMonth(this.configService.getExportTimezone(), reference);
  }

  resolvePeriodForMonth(year: number, month: number): { periodStart: Date; periodEnd: Date } {
    const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    return { periodStart, periodEnd };
  }

  async shouldSkipExport(
    scope: DatevExportScope,
    tenantId: string,
    year: number,
    month: number,
    force?: boolean,
  ): Promise<boolean> {
    if (force) {
      return false;
    }

    const storageOwnerTenantId = scope === DatevExportScope.UNIFIED ? DEFAULT_TENANT : tenantId;
    const existing = await this.exportRepository.findByPeriod(scope, storageOwnerTenantId, year, month);

    if (!existing) {
      return false;
    }

    return (
      existing.status === DatevExportStatus.COMPLETED ||
      existing.status === DatevExportStatus.PENDING ||
      existing.status === DatevExportStatus.RUNNING
    );
  }

  async runUnit(payload: DatevExportUnitPayload): Promise<void> {
    if (!this.configService.isEnabled()) {
      this.logger.debug('DATEV export disabled — skipping unit job');

      return;
    }

    const { periodStart, periodEnd } = this.resolvePeriodForMonth(payload.year, payload.month);

    if (payload.scope === DatevExportScope.UNIFIED && !this.configService.isUnifiedExportEnabled()) {
      this.logger.warn('Unified DATEV export is disabled — skipping unit job');

      return;
    }

    if (payload.scope === DatevExportScope.TENANT) {
      const tenantConfig = this.configService.resolveForTenant(payload.tenantId);

      if (!tenantConfig) {
        this.logger.warn(`DATEV config incomplete for tenant ${payload.tenantId} — skipping export`);

        return;
      }
    }

    if (await this.shouldSkipExport(payload.scope, payload.tenantId, payload.year, payload.month, payload.force)) {
      this.logger.log(
        `DATEV export already completed for ${payload.scope} ${payload.year}-${payload.month} — skipping`,
      );

      return;
    }

    const runParams = {
      scope: payload.scope,
      tenantId: payload.tenantId,
      year: payload.year,
      month: payload.month,
      periodStart,
      periodEnd,
      triggeredBy: payload.triggeredBy,
      force: payload.force,
    };

    const result =
      payload.scope === DatevExportScope.TENANT
        ? await runWithTenantId(payload.tenantId, () => this.exportService.runExport(runParams))
        : await this.exportService.runExport(runParams);

    if (result.status === DatevExportStatus.COMPLETED) {
      await this.auditLog.log({
        process: 'datev_export_completed',
        level: 'info',
        message: `DATEV export completed for ${payload.scope} ${payload.year}-${payload.month}`,
        context: {
          exportId: result.id,
          scope: payload.scope,
          year: payload.year,
          month: payload.month,
          bookingCount: result.bookingCount,
          invoiceCount: result.invoiceCount,
        },
      });
    } else if (result.status === DatevExportStatus.FAILED) {
      await this.auditLog.log({
        process: 'datev_export_failed',
        level: 'error',
        message: result.errorMessage ?? 'DATEV export failed',
        context: {
          exportId: result.id,
          scope: payload.scope,
          year: payload.year,
          month: payload.month,
        },
      });
    }
  }
}
