import { InvoiceStatus } from '../constants/invoice-status.constants';
import { TaxCategory } from '../constants/tax-category.constants';

export class InvoiceLineItemResponseDto {
  description!: string;
  quantity!: number;
  unitPriceNet!: number;
  taxCategory!: TaxCategory;
  taxRate!: number;
  lineNet!: number;
  lineTax!: number;
  lineGross!: number;
}

export class InvoiceTaxBreakdownDto {
  taxCategory!: TaxCategory;
  taxRate!: number;
  taxAmount!: number;
}

export class InvoiceDetailResponseDto {
  id!: string;
  subscriptionId?: string;
  invoiceNumber?: string;
  status!: InvoiceStatus;
  currency!: string;
  subtotalNet!: number;
  taxTotal!: number;
  totalGross!: number;
  balanceDue!: number;
  lineItems!: InvoiceLineItemResponseDto[];
  taxBreakdown!: InvoiceTaxBreakdownDto[];
  issuedAt?: Date;
  dueDate?: Date;
  createdAt!: Date;
  canPay!: boolean;
  canDownload!: boolean;
  canPreview!: boolean;
  canDownloadVoidDocument?: boolean;
  canDownloadTimeReport?: boolean;
  voidDocumentNumber?: string;
}
