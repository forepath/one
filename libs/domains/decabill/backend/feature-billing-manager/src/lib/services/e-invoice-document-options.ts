/**
 * UNTDID 1001 codes from the EN 16931 BT-3 code list (BR-CL-01): 380 commercial invoice, 381 credit note,
 * 325 proforma invoice (offers / quotations, which have no code of their own).
 */
export type EInvoiceDocumentTypeCode = '380' | '325' | '381';

export interface EInvoiceDocumentOptions {
  typeCode: EInvoiceDocumentTypeCode;
  documentId: string;
  issueDate: Date;
  duePayableAmount: number;
  includePaymentMeans: boolean;
  referencedInvoiceNumber?: string;
  /** Embed the document's payment terms (BT-20) and delivery terms (note, subject code AAR). */
  includeDocumentTerms?: boolean;
  /** Embed the payment due date (BT-9) from the document's due date. */
  includeDueDate?: boolean;
  /** Fixed BT-20 text (credit notes with an amount due, where the document carries no payment terms of its own). */
  paymentTermsDescription?: string;
}

export const DEFAULT_INVOICE_DOCUMENT_OPTIONS: Omit<EInvoiceDocumentOptions, 'documentId' | 'issueDate'> = {
  typeCode: '380',
  duePayableAmount: 0,
  includePaymentMeans: true,
};

export function buildCreditNoteDocumentOptions(
  creditNoteNumber: string,
  voidedAt: Date,
  originalInvoiceNumber: string,
): EInvoiceDocumentOptions {
  return {
    typeCode: '381',
    documentId: creditNoteNumber,
    issueDate: voidedAt,
    duePayableAmount: 0,
    includePaymentMeans: false,
    referencedInvoiceNumber: originalInvoiceNumber,
  };
}

/** How a partial credit is settled (withdrawal refunds and configuration-change credits). */
export function buildCreditNoteSettlementTerms(originalInvoiceNumber: string): string {
  return `Offset against the open balance of invoice ${originalInvoiceNumber}; any amount already paid is refunded or credited to future invoices.`;
}

export function buildCreditNoteNumber(invoiceNumber: string): string {
  return `${invoiceNumber}-CN`;
}

export function buildPartialCreditNoteNumber(invoiceNumber: string, suffix: string): string {
  return `${invoiceNumber}-CN-${suffix}`;
}

export function buildPartialCreditNoteDocumentOptions(
  creditNoteNumber: string,
  issuedAt: Date,
  originalInvoiceNumber: string,
  creditGross: number,
): EInvoiceDocumentOptions {
  return {
    typeCode: '381',
    documentId: creditNoteNumber,
    issueDate: issuedAt,
    duePayableAmount: creditGross,
    includePaymentMeans: false,
    referencedInvoiceNumber: originalInvoiceNumber,
    // BR-CO-25: a positive amount due needs a due date (BT-9) or payment terms (BT-20).
    paymentTermsDescription: buildCreditNoteSettlementTerms(originalInvoiceNumber),
  };
}

export function buildInvoiceDocumentOptions(invoice: {
  invoiceNumber?: string;
  id: string;
  issuedAt?: Date;
  createdAt: Date;
  balanceDue: number;
}): EInvoiceDocumentOptions {
  return {
    typeCode: '380',
    documentId: invoice.invoiceNumber ?? invoice.id,
    issueDate: invoice.issuedAt ?? invoice.createdAt,
    duePayableAmount: Number(invoice.balanceDue),
    includePaymentMeans: true,
    includeDocumentTerms: true,
    includeDueDate: true,
  };
}

export function buildZeroBalancePromotionalInvoiceDocumentOptions(invoice: {
  invoiceNumber?: string;
  id: string;
  issuedAt?: Date;
  createdAt: Date;
}): EInvoiceDocumentOptions {
  return {
    // A real (tax) invoice that is paid on issue by the promotion: commercial invoice, nothing due (prepaid).
    typeCode: '380',
    documentId: invoice.invoiceNumber ?? invoice.id,
    issueDate: invoice.issuedAt ?? invoice.createdAt,
    duePayableAmount: 0,
    includePaymentMeans: false,
    includeDocumentTerms: true,
  };
}

export function buildOfferDocumentOptions(offer: {
  offerNumber?: string | null;
  id: string;
  archivedAt?: Date | null;
  createdAt: Date;
  totalGross: number;
}): EInvoiceDocumentOptions {
  return {
    typeCode: '325',
    documentId: offer.offerNumber ?? offer.id,
    issueDate: offer.archivedAt ?? offer.createdAt,
    duePayableAmount: Number(offer.totalGross),
    includePaymentMeans: false,
    includeDocumentTerms: true,
  };
}
