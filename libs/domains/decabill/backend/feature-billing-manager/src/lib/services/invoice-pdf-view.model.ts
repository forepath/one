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
  paymentDetails?: InvoicePdfPaymentDetailsView;
}
