import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import { SupplierDocumentSource } from '../constants/supplier-document-source.constants';
import { TaxCategory } from '../constants/tax-category.constants';

export class SupplierInvoiceLineItemDto {
  @IsString({ message: 'Description must be a string' })
  description!: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(0.0001, { message: 'Quantity must be greater than zero' })
  quantity!: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'Unit price must be a number' })
  unitPriceNet!: number;

  @IsOptional()
  @IsEnum(TaxCategory, { message: 'Tax category must be standard, reduced, or custom' })
  taxCategory?: TaxCategory;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Tax rate must be a number' })
  @Min(0, { message: 'Tax rate must be zero or greater' })
  taxRate?: number;
}

/** Multipart sends lineItems as JSON text; nested @Type alone does not run after @Transform. */
function transformSupplierInvoiceLineItems({ value }: { value: unknown }): unknown {
  let parsed: unknown = value;

  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return value;
    }
  }

  if (!Array.isArray(parsed)) {
    return parsed;
  }

  return plainToInstance(SupplierInvoiceLineItemDto, parsed);
}

export class CreateSupplierInvoiceDto {
  @IsUUID('4', { message: 'Supplier ID must be a valid UUID' })
  supplierId!: string;

  @IsOptional()
  @IsString({ message: 'Contract number must be a string' })
  contractNumber?: string;

  @IsOptional()
  @IsString({ message: 'Invoice number must be a string' })
  @MaxLength(64, { message: 'Invoice number must be at most 64 characters' })
  invoiceNumber?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Issue date must be ISO 8601 date' })
  issueDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Due date must be ISO 8601 date' })
  dueDate?: string;

  @Transform(transformSupplierInvoiceLineItems)
  @IsArray({ message: 'Line items must be an array' })
  @ArrayMinSize(1, { message: 'At least one line item is required' })
  @ValidateNested({ each: true })
  @Type(() => SupplierInvoiceLineItemDto)
  lineItems!: SupplierInvoiceLineItemDto[];

  @IsOptional()
  @IsString({ message: 'Currency must be a string' })
  currency?: string;
}

export class UpdateSupplierInvoiceDto {
  @IsOptional()
  @IsString({ message: 'Contract number must be a string' })
  contractNumber?: string | null;

  @IsOptional()
  @IsString({ message: 'Invoice number must be a string' })
  @MaxLength(64, { message: 'Invoice number must be at most 64 characters' })
  invoiceNumber?: string | null;

  @IsOptional()
  @IsDateString({}, { message: 'Issue date must be ISO 8601 date' })
  issueDate?: string | null;

  @IsOptional()
  @IsDateString({}, { message: 'Due date must be ISO 8601 date' })
  dueDate?: string | null;

  @Transform(transformSupplierInvoiceLineItems)
  @IsArray({ message: 'Line items must be an array' })
  @ArrayMinSize(1, { message: 'At least one line item is required' })
  @ValidateNested({ each: true })
  @Type(() => SupplierInvoiceLineItemDto)
  lineItems!: SupplierInvoiceLineItemDto[];
}

export class IssueSupplierInvoiceDto {
  @IsOptional()
  @IsString({ message: 'Invoice number must be a string' })
  @MaxLength(64, { message: 'Invoice number must be at most 64 characters' })
  invoiceNumber?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Issue date must be ISO 8601 date' })
  issueDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Due date must be ISO 8601 date' })
  dueDate?: string;
}

export class MarkSupplierInvoicePaymentStatusDto {
  @IsOptional()
  @IsString({ message: 'Reason must be a string' })
  reason?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Paid at must be an ISO 8601 datetime' })
  paidAt?: string;
}

export class SupplierInvoiceLineItemResponseDto {
  id!: string;
  position!: number;
  description!: string;
  quantity!: number;
  unitPriceNet!: number;
  taxCategory!: TaxCategory;
  taxRate!: number;
  lineNet!: number;
  lineTax!: number;
  lineGross!: number;
}

export class SupplierInvoiceDetailResponseDto {
  id!: string;
  supplierId!: string;
  supplierNumber?: string;
  supplierName?: string;
  contractId?: string | null;
  contractNumber?: string | null;
  invoiceNumber?: string;
  status!: InvoiceStatus;
  currency!: string;
  subtotalNet!: number;
  taxTotal!: number;
  totalGross!: number;
  balanceDue!: number;
  taxMode?: string | null;
  taxCountryCode?: string | null;
  taxNote?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  issuedAt?: Date | null;
  voidedAt?: Date | null;
  paidAt?: Date | null;
  documentSource?: SupplierDocumentSource | null;
  hasUploadedDocument!: boolean;
  canDownload!: boolean;
  canPreview!: boolean;
  lineItems!: SupplierInvoiceLineItemResponseDto[];
  createdAt!: Date;
}

export class PaginatedSupplierInvoicesResponseDto {
  items!: SupplierInvoiceDetailResponseDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class SupplierInvoiceParsePreviewLineDto {
  description!: string;
  quantity!: number;
  unitPriceNet!: number;
  taxRate?: number;
  lineNet?: number;
  lineTax?: number;
  lineGross?: number;
}

export class SupplierInvoiceParsePreviewResponseDto {
  issueDate?: string | null;
  dueDate?: string | null;
  currency?: string | null;
  subtotalNet?: number | null;
  taxTotal?: number | null;
  totalGross?: number | null;
  lineItems!: SupplierInvoiceParsePreviewLineDto[];
  warnings!: string[];
}

export class SupplierExpenseStatisticsResponseDto {
  totalGross!: number;
  invoiceCount!: number;
  openCount!: number;
  openGross!: number;
  paidCount!: number;
  paidGross!: number;
  draftCount!: number;
  series!: { period: string; totalGross: number }[];
  from!: string;
  to!: string;
  groupBy!: 'day' | 'month';
}
