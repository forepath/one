import type {
  CustomerType,
  InvoiceStatus,
  TaxCategory,
  VatIdValidationSource,
  VatIdValidationStatus,
} from './billing.types';

export interface AdminSupplierProfileListItem {
  id: string;
  supplierNumber: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
  country?: string;
  isComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedAdminSupplierProfilesResponse {
  items: AdminSupplierProfileListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface SupplierProfileDto {
  firstName?: string;
  lastName?: string;
  company?: string;
  customerType?: CustomerType;
  vatId?: string | null;
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  phone?: string;
  /** Default expense account number for this supplier's invoices (accounting). */
  defaultExpenseAccountNumber?: string | null;
}

export type CreateAdminSupplierProfileDto = SupplierProfileDto;

export interface AdminSupplierProfileDetail extends SupplierProfileDto {
  id: string;
  supplierNumber: string;
  numberScope: string;
  datevCreditorNumber?: number | null;
  isComplete: boolean;
  vatIdValidationStatus?: VatIdValidationStatus;
  vatIdValidatedAt?: string | null;
  vatIdValidationSource?: VatIdValidationSource | null;
  customData: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface AddSupplierProfileCustomDataDto {
  key: string;
  value: string;
}

export interface UpdateSupplierProfileCustomDataDto {
  value: string;
}

export interface SupplierContractResponse {
  id: string;
  supplierId: string;
  contractNumber: string;
  createdAt: string;
}

export interface SupplierInvoiceLineItemDto {
  description: string;
  quantity: number;
  unitPriceNet: number;
  taxCategory?: TaxCategory;
  taxRate?: number;
  /** Account assignment (account number); defaults to the supplier's expense account. */
  ledgerAccountNumber?: string | null;
  /** Capitalize as fixed asset instead of expensing. */
  capitalizeAsAsset?: boolean;
  assetUsefulLifeMonths?: number | null;
  /** Stock article bought with this line. */
  inventoryArticleId?: string | null;
}

export interface CreateSupplierInvoiceDto {
  supplierId: string;
  contractNumber?: string;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  lineItems: SupplierInvoiceLineItemDto[];
  currency?: string;
}

export interface UpdateSupplierInvoiceDto {
  contractNumber?: string | null;
  invoiceNumber?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  lineItems: SupplierInvoiceLineItemDto[];
}

export interface IssueSupplierInvoiceDto {
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
}

export interface MarkSupplierInvoicePaymentStatusDto {
  reason?: string;
  paidAt?: string;
  /** Partial amount (gross); defaults to the full balance due. */
  amount?: number;
}

export interface SupplierInvoiceLineItemResponse {
  id: string;
  position: number;
  description: string;
  quantity: number;
  unitPriceNet: number;
  taxCategory: TaxCategory;
  taxRate: number;
  lineNet: number;
  lineTax: number;
  lineGross: number;
  ledgerAccountNumber?: string | null;
  capitalizeAsAsset?: boolean;
  assetUsefulLifeMonths?: number | null;
  inventoryArticleId?: string | null;
}

export interface AdminSupplierInvoiceListItem {
  id: string;
  supplierId: string;
  supplierNumber?: string;
  supplierName?: string;
  contractId?: string | null;
  contractNumber?: string | null;
  invoiceNumber?: string;
  status: InvoiceStatus | string;
  currency: string;
  subtotalNet: number;
  taxTotal: number;
  totalGross: number;
  balanceDue: number;
  issueDate?: string | null;
  dueDate?: string | null;
  hasUploadedDocument: boolean;
  createdAt: string;
  paidAt?: string | null;
  canDownload: boolean;
  canPreview: boolean;
  documentSource?: string | null;
}

export interface SupplierInvoiceDetailResponse extends AdminSupplierInvoiceListItem {
  taxMode?: string | null;
  taxCountryCode?: string | null;
  taxNote?: string | null;
  issuedAt?: string | null;
  voidedAt?: string | null;
  paidAt?: string | null;
  documentSource?: string | null;
  lineItems: SupplierInvoiceLineItemResponse[];
}

export interface PaginatedAdminSupplierInvoicesResponse {
  items: AdminSupplierInvoiceListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminSupplierInvoicesListParams {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
}

export interface SupplierInvoiceParsePreviewLine {
  description: string;
  quantity: number;
  unitPriceNet: number;
  taxRate?: number;
  lineNet?: number;
  lineTax?: number;
  lineGross?: number;
}

export interface SupplierInvoiceParsePreviewResponse {
  issueDate?: string | null;
  dueDate?: string | null;
  currency?: string | null;
  subtotalNet?: number | null;
  taxTotal?: number | null;
  totalGross?: number | null;
  lineItems: SupplierInvoiceParsePreviewLine[];
  warnings: string[];
}

export interface SupplierExpenseStatisticsParams {
  from?: string;
  to?: string;
  groupBy?: 'day' | 'month';
  supplierId?: string;
}

export interface SupplierExpenseSeriesPoint {
  period: string;
  totalGross: number;
}

export interface SupplierExpenseSummaryResponse {
  totalGross: number;
  invoiceCount: number;
  openCount: number;
  openGross: number;
  paidCount: number;
  paidGross: number;
  draftCount: number;
  series: SupplierExpenseSeriesPoint[];
  from: string;
  to: string;
  groupBy: 'day' | 'month';
}
