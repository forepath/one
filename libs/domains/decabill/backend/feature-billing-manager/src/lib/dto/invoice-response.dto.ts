import { InvoiceStatus } from '../constants/invoice-status.constants';

export class InvoiceResponseDto {
  id!: string;
  subscriptionId?: string;
  invoiceNumber?: string;
  status?: InvoiceStatus | string;
  balance?: number;
  subscriptionNumber?: string;
  createdAt!: Date;
  dueDate?: Date;
  canPay!: boolean;
  canDownload!: boolean;
  canPreview!: boolean;
  canDownloadVoidDocument?: boolean;
  canDownloadTimeReport?: boolean;
  voidDocumentNumber?: string;
}

export class InitiatePaymentResponseDto {
  checkoutUrl!: string;
}
