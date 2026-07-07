import type { InvoiceEntity } from '../entities/invoice.entity';

export interface InvoicePdfPresentationOptions {
  documentTitle: string;
  documentNumber: string;
  documentNumberLabel: string;
  issueDate: Date;
  showDueDate: boolean;
  showBalanceDue: boolean;
  referencedInvoiceNumber?: string;
  includePaymentDetails: boolean;
  creditGross?: number;
}

export function buildInvoicePdfPresentation(invoice: InvoiceEntity): InvoicePdfPresentationOptions {
  return {
    documentTitle: 'Invoice',
    documentNumber: invoice.invoiceNumber ?? invoice.id,
    documentNumberLabel: 'Invoice number',
    issueDate: invoice.issuedAt ?? invoice.createdAt,
    showDueDate: true,
    showBalanceDue: true,
    includePaymentDetails: true,
  };
}

export function buildCreditNotePdfPresentation(
  creditNoteNumber: string,
  voidedAt: Date,
  originalInvoiceNumber: string,
): InvoicePdfPresentationOptions {
  return {
    documentTitle: 'Credit note',
    documentNumber: creditNoteNumber,
    documentNumberLabel: 'Credit note number',
    issueDate: voidedAt,
    showDueDate: false,
    showBalanceDue: false,
    referencedInvoiceNumber: originalInvoiceNumber,
    includePaymentDetails: false,
  };
}

export function buildPartialCreditNotePdfPresentation(
  creditNoteNumber: string,
  issuedAt: Date,
  originalInvoiceNumber: string,
  creditGross: number,
): InvoicePdfPresentationOptions {
  return {
    documentTitle: 'Credit note',
    documentNumber: creditNoteNumber,
    documentNumberLabel: 'Credit note number',
    issueDate: issuedAt,
    showDueDate: false,
    showBalanceDue: true,
    referencedInvoiceNumber: originalInvoiceNumber,
    includePaymentDetails: false,
    creditGross,
  };
}
