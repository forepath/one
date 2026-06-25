import { DEFAULT_TENANT, getTenantIdOrDefault } from '@forepath/shared/backend';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';

import { DatevExportScope, DatevExportStatus } from '../constants/datev-export.constants';
import type {
  AdminDatevExportListItemDto,
  PaginatedAdminDatevExportsResponseDto,
  TriggerDatevExportDto,
  TriggerDatevExportResponseDto,
} from '../dto/admin-datev-export.dto';
import type { DatevExportEntity } from '../entities/datev-export.entity';
import { DATEV_EXPORT_ENQUEUE, type DatevExportEnqueuePort } from '../queue/datev-export-enqueue.token';
import { DatevExportRepository } from '../repositories/datev-export.repository';
import { DatevExportConfigService } from './datev-export-config.service';
import { DatevExportStorageService } from './datev-export-storage.service';

@Injectable()
export class DatevExportAdminService {
  constructor(
    private readonly configService: DatevExportConfigService,
    private readonly exportRepository: DatevExportRepository,
    private readonly storageService: DatevExportStorageService,
    @Optional() @Inject(DATEV_EXPORT_ENQUEUE) private readonly enqueuePort?: DatevExportEnqueuePort,
  ) {}

  assertUnifiedAccessAllowed(): void {
    const tenantId = getTenantIdOrDefault();

    if (!this.configService.isUnifiedExportAllowedForTenant(tenantId)) {
      throw new ForbiddenException('Unified DATEV export access is not allowed for this tenant');
    }
  }

  async listExports(
    scope: DatevExportScope,
    limit: number,
    offset: number,
    year?: number,
  ): Promise<PaginatedAdminDatevExportsResponseDto> {
    if (scope === DatevExportScope.UNIFIED) {
      this.assertUnifiedAccessAllowed();
    }

    const tenantId = getTenantIdOrDefault();
    const result = await this.exportRepository.findAllForAdmin({
      scope,
      tenantId: scope === DatevExportScope.TENANT ? tenantId : undefined,
      year,
      limit,
      offset,
    });

    return {
      items: result.items.map((item) => this.mapToListItem(item)),
      total: result.total,
      limit,
      offset,
    };
  }

  async getExport(exportId: string): Promise<AdminDatevExportListItemDto> {
    const entity = await this.findAccessibleExport(exportId);

    return this.mapToListItem(entity);
  }

  async downloadExport(exportId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const entity = await this.findAccessibleExport(exportId);

    if (entity.status !== DatevExportStatus.COMPLETED || !entity.storageKey || !entity.fileName) {
      throw new NotFoundException('Export file is not available');
    }

    const buffer = await this.storageService.readFile(entity.storageKey);

    return { buffer, fileName: entity.fileName };
  }

  async triggerExport(triggeredBy: string, dto: TriggerDatevExportDto): Promise<TriggerDatevExportResponseDto> {
    if (!this.enqueuePort) {
      throw new InternalServerErrorException('Billing queue is not configured');
    }

    const scope = dto.scope ?? DatevExportScope.TENANT;
    const tenantId = getTenantIdOrDefault();

    if (scope === DatevExportScope.UNIFIED) {
      this.assertUnifiedAccessAllowed();
    }

    await this.assertExportCanBeTriggered(scope, tenantId, dto.year, dto.month, dto.force);

    await this.enqueuePort.enqueueUnit({
      tenantId: scope === DatevExportScope.UNIFIED ? DEFAULT_TENANT : tenantId,
      scope,
      year: dto.year,
      month: dto.month,
      triggeredBy,
      force: dto.force,
    });

    return {
      queued: true,
      scope,
      year: dto.year,
      month: dto.month,
    };
  }

  private async assertExportCanBeTriggered(
    scope: DatevExportScope,
    tenantId: string,
    year: number,
    month: number,
    force?: boolean,
  ): Promise<void> {
    if (scope === DatevExportScope.TENANT) {
      if (!this.configService.resolveForTenant(tenantId)) {
        throw new BadRequestException('DATEV export configuration is incomplete for this tenant');
      }
    } else if (!this.configService.isUnifiedExportEnabled()) {
      throw new BadRequestException('Unified DATEV export is disabled');
    } else {
      const unifiedConfig = this.configService.resolveUnified() ?? this.configService.resolveForTenant(DEFAULT_TENANT);

      if (!unifiedConfig) {
        throw new BadRequestException('DATEV unified export configuration is incomplete');
      }
    }

    const storageOwnerTenantId = scope === DatevExportScope.UNIFIED ? DEFAULT_TENANT : tenantId;
    const existing = await this.exportRepository.findByPeriod(scope, storageOwnerTenantId, year, month);

    if (!existing || force) {
      return;
    }

    if (existing.status === DatevExportStatus.COMPLETED) {
      throw new BadRequestException('Export for this period is already completed');
    }

    if (existing.status === DatevExportStatus.PENDING || existing.status === DatevExportStatus.RUNNING) {
      throw new BadRequestException('Export for this period is already in progress');
    }
  }

  private async findAccessibleExport(exportId: string): Promise<DatevExportEntity> {
    const entity = await this.exportRepository.findById(exportId);

    if (!entity) {
      throw new NotFoundException('Export not found');
    }

    const requestTenantId = getTenantIdOrDefault();

    if (entity.scope === DatevExportScope.TENANT && entity.tenantId !== requestTenantId) {
      throw new ForbiddenException('Export belongs to another tenant');
    }

    if (entity.scope === DatevExportScope.UNIFIED) {
      this.assertUnifiedAccessAllowed();
    }

    return entity;
  }

  private mapToListItem(entity: DatevExportEntity): AdminDatevExportListItemDto {
    return {
      id: entity.id,
      scope: entity.scope,
      tenantId: entity.tenantId,
      periodYear: entity.periodYear,
      periodMonth: entity.periodMonth,
      status: entity.status,
      fileName: entity.fileName,
      bookingCount: entity.bookingCount,
      invoiceCount: entity.invoiceCount,
      debtorCount: entity.debtorCount,
      includedTenantIds: entity.includedTenantIds,
      errorMessage: entity.errorMessage,
      triggeredBy: entity.triggeredBy,
      startedAt: entity.startedAt,
      completedAt: entity.completedAt,
      createdAt: entity.createdAt,
    };
  }
}
