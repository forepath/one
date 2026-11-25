import { DocumentDeliveryChannel } from '../constants/document-delivery.constants';
import { InvoiceStatus } from '../constants/invoice-status.constants';
import type { InvoiceEntity } from '../entities/invoice.entity';

/**
 * Admin-only delivery state of a customer invoice: whether (and how) the invoice and, for voided invoices, its credit
 * note were sent, and which send action applies. Customers never see these fields.
 */
export function invoiceDeliveryFields(
  invoice: Pick<
    InvoiceEntity,
    'status' | 'invoiceNumber' | 'sentAt' | 'voidDocumentSentAt' | 'sentVia' | 'voidDocumentSentVia'
  >,
): {
  sentAt: string | null;
  sentVia: DocumentDeliveryChannel | null;
  voidDocumentSentAt: string | null;
  voidDocumentSentVia: DocumentDeliveryChannel | null;
  canSend: boolean;
  canSendCreditNote: boolean;
} {
  const numbered = Boolean(invoice.invoiceNumber);
  const voided = invoice.status === InvoiceStatus.VOID;

  return {
    sentAt: toIso(invoice.sentAt),
    sentVia: invoice.sentAt ? (invoice.sentVia ?? DocumentDeliveryChannel.EMAIL) : null,
    voidDocumentSentAt: toIso(invoice.voidDocumentSentAt),
    voidDocumentSentVia: invoice.voidDocumentSentAt
      ? (invoice.voidDocumentSentVia ?? DocumentDeliveryChannel.EMAIL)
      : null,
    canSend: numbered && invoice.status !== InvoiceStatus.DRAFT && !voided && !invoice.sentAt,
    canSendCreditNote: numbered && voided && !invoice.voidDocumentSentAt,
  };
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
