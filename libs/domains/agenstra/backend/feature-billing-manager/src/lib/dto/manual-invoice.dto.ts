import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

import { TaxCategory } from '../constants/tax-category.constants';

import { InvoiceDetailResponseDto } from './invoice-detail-response.dto';

export class ManualInvoiceLineItemDto {
  @IsString({ message: 'Description must be a string' })
  description!: string;

  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(0.0001, { message: 'Quantity must be greater than zero' })
  quantity!: number;

  @IsNumber({}, { message: 'Unit price must be a number' })
  unitPriceNet!: number;

  @IsOptional()
  @IsEnum(TaxCategory, { message: 'Tax category must be standard or reduced' })
  taxCategory?: TaxCategory;
}

export class CreateManualInvoiceDto {
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  userId!: string;

  @IsOptional()
  @IsUUID('4', { message: 'Subscription ID must be a valid UUID' })
  subscriptionId?: string;

  @IsArray({ message: 'Line items must be an array' })
  @ArrayMinSize(1, { message: 'At least one line item is required' })
  @ValidateNested({ each: true })
  @Type(() => ManualInvoiceLineItemDto)
  lineItems!: ManualInvoiceLineItemDto[];

  @IsOptional()
  @IsString({ message: 'Currency must be a string' })
  currency?: string;
}

export class UpdateManualInvoiceDto {
  @IsArray({ message: 'Line items must be an array' })
  @ArrayMinSize(1, { message: 'At least one line item is required' })
  @ValidateNested({ each: true })
  @Type(() => ManualInvoiceLineItemDto)
  lineItems!: ManualInvoiceLineItemDto[];
}

export class IssueManualInvoiceDto {
  @IsOptional()
  @IsInt({ message: 'Due in days must be an integer' })
  @Min(1, { message: 'Due in days must be at least 1' })
  dueInDays?: number;
}

export class ManualInvoiceDetailResponseDto extends InvoiceDetailResponseDto {
  userId!: string;
  userEmail?: string;
}
