import { IsArray, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { TaxCategory } from '../constants/tax-category.constants';

export class TaxPreviewLineItemDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsNumber()
  unitPriceNet!: number;

  @IsOptional()
  @IsString()
  taxCategory?: TaxCategory;
}

export class TaxPreviewRequestDto {
  /** When set (admin), resolve tax for this customer. When omitted, issuer domestic rates. */
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaxPreviewLineItemDto)
  lineItems?: TaxPreviewLineItemDto[];
}

export interface TaxPreviewRatesDto {
  standard: number;
  reduced: number;
}

export interface TaxPreviewLineResponseDto {
  description: string;
  quantity: number;
  unitPriceNet: number;
  taxCategory: TaxCategory;
  taxRate: number;
  lineNet: number;
  lineTax: number;
  lineGross: number;
}

export interface TaxPreviewResponseDto {
  taxMode: string;
  taxCountryCode: string;
  chargeVat: boolean;
  taxNote: string | null;
  einvoiceTaxCategoryCode: string;
  rates: TaxPreviewRatesDto;
  subtotalNet?: number;
  taxTotal?: number;
  totalGross?: number;
  lines?: TaxPreviewLineResponseDto[];
}
