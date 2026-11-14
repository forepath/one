import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { TaxCategory } from '../constants/tax-category.constants';
import { BillingIntervalType } from '../entities/service-plan.entity';

import { DocumentTermsInputDto } from './document-terms.dto';
import { ServicePlanOrderingHighlightDto } from './service-plan-ordering-highlight.dto';

/** Inherits optional payment / delivery terms (null = global default). */
export class CreateServicePlanDto extends DocumentTermsInputDto {
  /** UUID of a catalog service type, or null/omitted for no deployment. */
  @IsOptional()
  @ValidateIf((_, value) => value != null && value !== '')
  @IsUUID('4', { message: 'Service type ID must be a UUID or null' })
  serviceTypeId?: string | null;

  @IsNotEmpty({ message: 'Name is required' })
  @IsString({ message: 'Name must be a string' })
  name!: string;

  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @IsNotEmpty({ message: 'Billing interval type is required' })
  @IsEnum(BillingIntervalType, { message: 'Billing interval type must be hour, day, month, or year' })
  billingIntervalType!: BillingIntervalType;

  @IsNotEmpty({ message: 'Billing interval value is required' })
  @IsInt({ message: 'Billing interval value must be an integer' })
  @Min(1)
  billingIntervalValue!: number;

  @IsOptional()
  @IsInt({ message: 'Billing day of month must be an integer' })
  @Min(1)
  @Max(31)
  billingDayOfMonth?: number;

  @IsOptional()
  @IsBoolean({ message: 'cancelAtPeriodEnd must be a boolean' })
  cancelAtPeriodEnd?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'billInAdvance must be a boolean' })
  billInAdvance?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'autoRecalculatePriceDaily must be a boolean' })
  autoRecalculatePriceDaily?: boolean;

  @IsOptional()
  @IsInt({ message: 'minCommitmentDays must be an integer' })
  @Min(0)
  minCommitmentDays?: number;

  @IsOptional()
  @IsInt({ message: 'noticeDays must be an integer' })
  @Min(0)
  noticeDays?: number;

  @IsOptional()
  @IsNumberString({}, { message: 'Base price must be a numeric string' })
  basePrice?: string;

  @IsOptional()
  @IsNumberString({}, { message: 'Margin percent must be a numeric string' })
  marginPercent?: string;

  @IsOptional()
  @IsNumberString({}, { message: 'Margin fixed must be a numeric string' })
  marginFixed?: string;

  @IsOptional()
  @IsObject({ message: 'Provider config defaults must be an object' })
  providerConfigDefaults?: Record<string, unknown>;

  @IsOptional()
  @IsArray({ message: 'Ordering highlights must be an array' })
  @ArrayMaxSize(50, { message: 'At most 50 ordering highlights are allowed' })
  @ValidateNested({ each: true })
  @Type(() => ServicePlanOrderingHighlightDto)
  orderingHighlights?: ServicePlanOrderingHighlightDto[];

  @IsOptional()
  @IsBoolean({ message: 'isActive must be a boolean' })
  isActive?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'allowCustomerLocationSelection must be a boolean' })
  allowCustomerLocationSelection?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'allowCustomerServerTypeSelection must be a boolean' })
  allowCustomerServerTypeSelection?: boolean;

  @IsOptional()
  @IsArray({ message: 'allowedServerTypes must be an array' })
  @IsString({ each: true, message: 'Each allowed server type must be a string' })
  allowedServerTypes?: string[];

  @IsOptional()
  @IsBoolean({ message: 'allowCustomerProviderSelection must be a boolean' })
  allowCustomerProviderSelection?: boolean;

  @IsOptional()
  @IsArray({ message: 'allowedProviders must be an array' })
  @IsString({ each: true, message: 'Each allowed provider must be a string' })
  allowedProviders?: string[];

  @IsOptional()
  @IsEnum(TaxCategory, { message: 'taxCategory must be standard or reduced' })
  taxCategory?: TaxCategory;
}
