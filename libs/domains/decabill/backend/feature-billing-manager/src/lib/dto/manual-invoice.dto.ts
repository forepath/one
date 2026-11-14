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
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { PAYMENT_DUE_DAYS_MAX } from '../constants/document-terms.constants';
import { TaxCategory } from '../constants/tax-category.constants';

import { DeliveryTermsInputDto } from './document-terms.dto';

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

/**
 * Payment terms (`dueInDays`) and delivery terms for this invoice. Omitted values inherit from the subscription's
 * service plan, then the global default.
 */
export class IssueManualInvoiceDto extends DeliveryTermsInputDto {
  @IsOptional()
  @IsInt({ message: 'Due in days must be an integer' })
  @Min(0, { message: 'Due in days must be at least 0' })
  @Max(PAYMENT_DUE_DAYS_MAX, { message: `Due in days must be at most ${PAYMENT_DUE_DAYS_MAX}` })
  dueInDays?: number | null;
}

export class ManualInvoiceDetailResponseDto extends InvoiceDetailResponseDto {
  userId!: string;
  userEmail?: string;
}
