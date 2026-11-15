import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { ManualInvoiceLineItemDto } from '../../dto/manual-invoice.dto';
import { ProjectPricingModel, ProjectStatus } from '../entities/project.enums';

export class CreateAdminProjectDto {
  @IsUUID('4')
  userId!: string;

  @IsString()
  @Length(1, 255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  hourlyRateNet!: number;

  @IsOptional()
  @IsString()
  @Length(3, 10)
  currency?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  targetHours?: number | null;

  /** `hourly` (default), `capped` (hourly up to `priceLimitNet`) or `fixed` (`priceLimitNet` is the fixed price). */
  @IsOptional()
  @IsEnum(ProjectPricingModel)
  pricingModel?: ProjectPricingModel;

  /** Maximum price (`capped`) or fixed price (`fixed`), net. Required for those models; ignored for `hourly`. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.01)
  @Max(99_999_999)
  priceLimitNet?: number | null;
}

export class UpdateAdminProjectDto {
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  hourlyRateNet?: number;

  @IsOptional()
  @IsString()
  @Length(3, 10)
  currency?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  targetHours?: number | null;

  /** `hourly` (default), `capped` (hourly up to `priceLimitNet`) or `fixed` (`priceLimitNet` is the fixed price). */
  @IsOptional()
  @IsEnum(ProjectPricingModel)
  pricingModel?: ProjectPricingModel;

  /** Maximum price (`capped`) or fixed price (`fixed`), net. Required for those models; ignored for `hourly`. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.01)
  @Max(99_999_999)
  priceLimitNet?: number | null;
}

export class ProjectResponseDto {
  id!: string;
  userId!: string;
  name!: string;
  description?: string | null;
  status!: ProjectStatus;
  hourlyRateNet!: number;
  pricingModel!: ProjectPricingModel;
  /** Maximum price (`capped`) or fixed price (`fixed`), net; null for `hourly`. */
  priceLimitNet!: number | null;
  targetHours?: number | null;
  currency!: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export class ProjectListItemDto extends ProjectResponseDto {
  unbilledMinutes!: number;
  openBillableAmountNet!: number;
}

export class AdminProjectListItemDto extends ProjectListItemDto {
  userEmail?: string;
  /** Billing-profile name (company, else first + last name). */
  customerName?: string;
}

export class PaginatedProjectsResponseDto {
  items!: ProjectListItemDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class PaginatedAdminProjectsResponseDto {
  items!: AdminProjectListItemDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

/** Catalog counts for the customer projects overview KPI (not a single-project detail summary). */
export class ProjectsCatalogSummaryResponseDto {
  total!: number;
  active!: number;
}

export class ProjectSummaryResponseDto {
  projectId!: string;
  totalTrackedMinutes!: number;
  unbilledMinutes!: number;
  openBillableAmountNet!: number;
  billedAmountNet!: number;
  /** Amount still billable under the maximum / fixed price; null for unlimited hourly projects. */
  remainingPriceNet!: number | null;
  openTicketCount!: number;
  doneTicketCount!: number;
  milestoneCount!: number;
  openMilestoneCount!: number;
}

export class BillProjectTimeResponseDto {
  /** Null when the price limit was already exhausted: the entries were marked as covered without an invoice. */
  invoiceId!: string | null;
  invoiceNumber?: string;
  billedMinutes!: number;
  amountNet!: number;
}

export class BillProjectTimeDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsUUID('4', { message: 'Subscription ID must be a valid UUID' })
  subscriptionId?: string;

  /** Fixed-price projects only: instalment to bill (defaults to the whole remaining fixed price). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.01)
  amountNet?: number;

  @IsOptional()
  @IsArray({ message: 'Line items must be an array' })
  @ValidateNested({ each: true })
  @Type(() => ManualInvoiceLineItemDto)
  lineItems?: ManualInvoiceLineItemDto[];
}

export class ProjectTimeReportRequestDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @Type(() => Boolean)
  unbilledOnly?: boolean;
}

export class ProjectUnbilledTimeBoundsDto {
  from?: Date | null;
  to?: Date | null;
  entryCount!: number;
}
