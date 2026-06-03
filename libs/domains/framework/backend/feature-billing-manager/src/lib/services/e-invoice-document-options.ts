export type EInvoiceDocumentTypeCode = '380' | '381';

export interface EInvoiceDocumentOptions {
  typeCode: EInvoiceDocumentTypeCode;
  documentId: string;
  issueDate: Date;
  duePayableAmount: number;
  includePaymentMeans: boolean;
  referencedInvoiceNumber?: string;
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

export function buildCreditNoteNumber(invoiceNumber: string): string {
  return `${invoiceNumber}-CN`;
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
  };
}
