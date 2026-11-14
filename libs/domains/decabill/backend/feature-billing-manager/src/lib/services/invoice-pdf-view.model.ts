export interface InvoicePdfAddressView {
  name: string;
  lines: string[];
  vatId?: string;
  email?: string;
}

export interface InvoicePdfLineItemView {
  position: number;
  description: string;
  quantity: string;
  unitPriceNet: string;
  taxRate: string;
  lineNet: string;
  lineTax: string;
  lineGross: string;
}

export interface InvoicePdfPaymentDetailsView {
  bank?: string;
  iban?: string;
  bic?: string;
}

export interface InvoicePdfViewModel {
  documentTitle: string;
  documentNumberLabel: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  referencedInvoiceNumber?: string;
  showDueDate: boolean;
  showBalanceDue: boolean;
  statusLabel: string;
  currency: string;
  issuer: InvoicePdfAddressView;
  buyer: InvoicePdfAddressView;
  lineItems: InvoicePdfLineItemView[];
  subtotalNet: string;
  taxTotal: string;
  totalGross: string;
  balanceDue: string;
  taxNote?: string;
  taxModeLabel?: string;
  paymentDetails?: InvoicePdfPaymentDetailsView;
  /** "Service date" (single day) or "Service period". */
  servicePeriodLabel?: string;
  servicePeriod?: string;
  /** Printed payment terms, e.g. "Payable within 14 days of the invoice date without deduction." */
  paymentTerms?: string;
  /** Printed delivery terms (Incoterms® 2020 rule or custom text). */
  deliveryTerms?: string;
  showDocumentTerms?: boolean;
  /** EPC069-12 SEPA credit transfer QR (SVG data URI); only for open EUR invoices with a valid IBAN. */
  epcQrDataUri?: string;
  /** Identity short SHA stamped when file signing is enabled. */
  authenticityShortSha?: string;
}
