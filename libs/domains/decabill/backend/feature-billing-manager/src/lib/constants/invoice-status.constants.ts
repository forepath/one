export enum InvoiceStatus {
  DRAFT = 'draft',
  ISSUED = 'issued',
  PAID = 'paid',
  PARTIALLY_PAID = 'partially_paid',
  OVERDUE = 'overdue',
  VOID = 'void',
  /** Fully settled without cash, by credit notes / customer credit (no payment received). */
  CREDITED = 'credited',
  /** Remaining balance written off as uncollectible (Forderungsverlust). */
  WRITTEN_OFF = 'written_off',
}

export const OPEN_OVERDUE_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
];

/** Customer invoice history (excludes drafts and open/overdue). */
export const HISTORY_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.PAID,
  InvoiceStatus.CREDITED,
  InvoiceStatus.WRITTEN_OFF,
  InvoiceStatus.VOID,
];

/** Fully settled (balance due 0 or customer credit); no further payments expected. */
export const SETTLED_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.PAID,
  InvoiceStatus.CREDITED,
  InvoiceStatus.WRITTEN_OFF,
];

/** Statuses customers may see via list/detail APIs (never draft). */
export const CUSTOMER_VISIBLE_INVOICE_STATUSES: InvoiceStatus[] = [
  ...OPEN_OVERDUE_INVOICE_STATUSES,
  ...HISTORY_INVOICE_STATUSES,
];

/** Issued invoices included in admin billing turnover charts (excludes draft/void). */
export const BILLED_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.PAID,
  InvoiceStatus.CREDITED,
  InvoiceStatus.WRITTEN_OFF,
];

/** @deprecated Use OPEN_OVERDUE_INVOICE_STATUSES */
export const OPEN_OVERDUE_INVOICE_STATUS_IDS = OPEN_OVERDUE_INVOICE_STATUSES;
