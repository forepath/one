import type { InvoiceEntity } from '../entities/invoice.entity';

import { buildCreditNoteSettlementTerms } from './e-invoice-document-options';
import type { InvoicingPeriod } from './invoicing-period.util';

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
  /** Print the document's payment / delivery terms (invoices only; credit notes reference the original). */
  includeDocumentTerms?: boolean;
  /** Service period (Leistungszeitraum) printed in the header; same as the e-invoice billing period. */
  servicePeriod?: InvoicingPeriod;
  /** Fixed payment-terms text (partial credit notes), printed instead of the document's own terms. */
  paymentTermsText?: string;
  /** Print the EPC069-12 SEPA payment QR (GiroCode) next to the bank details when applicable. */
  includePaymentQr?: boolean;
}

export interface BuildInvoicePdfPresentationOptions {
  zeroBalancePromotional?: boolean;
  /** Calendar document issue date (YYYY-MM-DD or Date). Preferred over lifecycle issuedAt. */
  documentIssueDate?: Date | string | null;
  /** Service period printed on the document (customer invoices). */
  servicePeriod?: InvoicingPeriod;
  /** Opt-in SEPA payment QR (customer invoices only; supplier copies never get one). */
  includePaymentQr?: boolean;
}

/**
 * Resolves the date printed on invoice PDFs as "Issue date".
 * Prefer an explicit calendar issue date (supplier expenses) over lifecycle issuedAt.
 */
export function resolveInvoicePdfIssueDate(invoice: InvoiceEntity, documentIssueDate?: Date | string | null): Date {
  if (documentIssueDate instanceof Date && !Number.isNaN(documentIssueDate.getTime())) {
    return documentIssueDate;
  }

  if (typeof documentIssueDate === 'string' && documentIssueDate.trim()) {
    return parseCalendarDate(documentIssueDate);
  }

  const calendarIssueDate = (invoice as InvoiceEntity & { issueDate?: string | Date | null }).issueDate;

  if (calendarIssueDate instanceof Date && !Number.isNaN(calendarIssueDate.getTime())) {
    return calendarIssueDate;
  }

  if (typeof calendarIssueDate === 'string' && calendarIssueDate.trim()) {
    return parseCalendarDate(calendarIssueDate);
  }

  return invoice.issuedAt ?? invoice.createdAt;
}

function parseCalendarDate(value: string): Date {
  const dateOnly = value.trim().slice(0, 10);

  return new Date(`${dateOnly}T12:00:00.000Z`);
}

export function buildInvoicePdfPresentation(
  invoice: InvoiceEntity,
  options?: BuildInvoicePdfPresentationOptions,
): InvoicePdfPresentationOptions {
  const issueDate = resolveInvoicePdfIssueDate(invoice, options?.documentIssueDate);

  if (options?.zeroBalancePromotional) {
    return {
      documentTitle: 'Invoice',
      documentNumber: invoice.invoiceNumber ?? invoice.id,
      documentNumberLabel: 'Invoice number',
      issueDate,
      showDueDate: false,
      showBalanceDue: false,
      includePaymentDetails: false,
      includeDocumentTerms: true,
      ...(options.servicePeriod ? { servicePeriod: options.servicePeriod } : {}),
    };
  }

  return {
    documentTitle: 'Invoice',
    documentNumber: invoice.invoiceNumber ?? invoice.id,
    documentNumberLabel: 'Invoice number',
    issueDate,
    showDueDate: true,
    showBalanceDue: true,
    includePaymentDetails: true,
    includeDocumentTerms: true,
    includePaymentQr: options?.includePaymentQr === true,
    ...(options?.servicePeriod ? { servicePeriod: options.servicePeriod } : {}),
  };
}

export function buildCreditNotePdfPresentation(
  creditNoteNumber: string,
  voidedAt: Date,
  originalInvoiceNumber: string,
  servicePeriod?: InvoicingPeriod,
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
    ...(servicePeriod ? { servicePeriod } : {}),
  };
}

export function buildPartialCreditNotePdfPresentation(
  creditNoteNumber: string,
  issuedAt: Date,
  originalInvoiceNumber: string,
  creditGross: number,
  servicePeriod?: InvoicingPeriod,
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
    paymentTermsText: buildCreditNoteSettlementTerms(originalInvoiceNumber),
    ...(servicePeriod ? { servicePeriod } : {}),
  };
}
