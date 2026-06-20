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
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { BillingIntervalType } from '../entities/service-plan.entity';

import { ServicePlanOrderingHighlightDto } from './service-plan-ordering-highlight.dto';

export class CreateServicePlanDto {
  @IsNotEmpty({ message: 'Service type ID is required' })
  @IsString({ message: 'Service type ID must be a string' })
  serviceTypeId!: string;

  @IsNotEmpty({ message: 'Name is required' })
  @IsString({ message: 'Name must be a string' })
  name!: string;

  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @IsNotEmpty({ message: 'Billing interval type is required' })
  @IsEnum(BillingIntervalType, { message: 'Billing interval type must be hour, day, or month' })
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
}
