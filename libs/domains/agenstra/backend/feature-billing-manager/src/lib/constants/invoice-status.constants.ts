export enum InvoiceStatus {
  DRAFT = 'draft',
  ISSUED = 'issued',
  PAID = 'paid',
  PARTIALLY_PAID = 'partially_paid',
  OVERDUE = 'overdue',
  VOID = 'void',
}

export const OPEN_OVERDUE_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
];

/** Issued invoices included in admin billing turnover charts (excludes draft/void). */
export const BILLED_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.PAID,
];

/** @deprecated Use OPEN_OVERDUE_INVOICE_STATUSES */
export const OPEN_OVERDUE_INVOICE_STATUS_IDS = OPEN_OVERDUE_INVOICE_STATUSES;
