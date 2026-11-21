import { InvoiceStatus } from '../constants/invoice-status.constants';
import type { InvoiceEntity } from '../entities/invoice.entity';

/**
 * Admin-only delivery state of a customer invoice: whether the invoice and (for voided invoices) its credit note were
 * emailed, and which send action applies. Customers never see these fields.
 */
export function invoiceDeliveryFields(
  invoice: Pick<InvoiceEntity, 'status' | 'invoiceNumber' | 'sentAt' | 'voidDocumentSentAt'>,
): { sentAt: string | null; voidDocumentSentAt: string | null; canSend: boolean; canSendCreditNote: boolean } {
  const numbered = Boolean(invoice.invoiceNumber);
  const voided = invoice.status === InvoiceStatus.VOID;

  return {
    sentAt: toIso(invoice.sentAt),
    voidDocumentSentAt: toIso(invoice.voidDocumentSentAt),
    canSend: numbered && invoice.status !== InvoiceStatus.DRAFT && !voided && !invoice.sentAt,
    canSendCreditNote: numbered && voided && !invoice.voidDocumentSentAt,
  };
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
