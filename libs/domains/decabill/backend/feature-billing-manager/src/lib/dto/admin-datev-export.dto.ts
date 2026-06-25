import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { DatevExportScope, type DatevExportStatus } from '../constants/datev-export.constants';

export interface BillingCapabilitiesResponseDto {
  datevExportEnabled: boolean;
  unifiedExportAllowed: boolean;
}

export interface AdminDatevExportListItemDto {
  id: string;
  scope: DatevExportScope;
  tenantId: string;
  periodYear: number;
  periodMonth: number;
  status: DatevExportStatus;
  fileName?: string;
  bookingCount: number;
  invoiceCount: number;
  debtorCount: number;
  includedTenantIds?: string[];
  errorMessage?: string;
  triggeredBy?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export interface PaginatedAdminDatevExportsResponseDto {
  items: AdminDatevExportListItemDto[];
  total: number;
  limit: number;
  offset: number;
}

export class TriggerDatevExportDto {
  @IsInt({ message: 'Year must be an integer' })
  @Min(2000, { message: 'Year must be 2000 or later' })
  @Max(2100, { message: 'Year must be 2100 or earlier' })
  year!: number;

  @IsInt({ message: 'Month must be an integer' })
  @Min(1, { message: 'Month must be between 1 and 12' })
  @Max(12, { message: 'Month must be between 1 and 12' })
  month!: number;

  @IsOptional()
  @IsEnum(DatevExportScope, { message: 'Scope must be tenant or unified' })
  scope?: DatevExportScope;

  @IsOptional()
  @IsBoolean({ message: 'Force must be a boolean' })
  force?: boolean;
}

export interface TriggerDatevExportResponseDto {
  queued: boolean;
  scope: DatevExportScope;
  year: number;
  month: number;
}
