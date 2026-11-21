/** Inventory (admin-only): warehouses → compartments → article placements, movements and withdrawal requests. */

export type InventoryMovementType = 'putaway' | 'transfer' | 'withdrawal' | 'lending' | 'lending_return';
export type InventorySerialUnitStatus = 'in_stock' | 'lent' | 'withdrawn';
export type InventoryLendingStatus = 'open' | 'returned';
export type InventoryBorrowerKind = 'customer' | 'staff';
export type InventoryLabelKind = 'article_number' | 'ean' | 'property';
export type InventoryLabelLayout = 'sheet' | 'single';
export type InventoryMovementReason =
  | 'receipt'
  | 'return'
  | 'fulfillment'
  | 'consumption'
  | 'damage'
  | 'loss'
  | 'correction'
  | 'other';
export type InventoryWithdrawalRequestStatus = 'pending' | 'accepted' | 'rejected';
export type InventoryWithdrawalRequestSource = 'offer' | 'invoice' | 'subscription';
export type InventoryTaxCategory = 'standard' | 'reduced';

export const INVENTORY_ARTICLE_UNITS = [
  'piece',
  'pack',
  'box',
  'pallet',
  'set',
  'kg',
  'g',
  'l',
  'ml',
  'm',
  'm2',
  'm3',
] as const;

export const INVENTORY_PUTAWAY_REASONS: readonly InventoryMovementReason[] = [
  'receipt',
  'return',
  'correction',
  'other',
];
/** Direct withdrawals; `fulfillment` is reserved for accepted requests. */
export const INVENTORY_WITHDRAWAL_REASONS: readonly InventoryMovementReason[] = [
  'consumption',
  'damage',
  'loss',
  'correction',
  'other',
];

export interface PaginatedInventoryResponse<T> {
  items: T[];
  total: number;
}

export interface InventoryListParams {
  limit?: number;
  offset?: number;
  search?: string;
}

export interface InventoryWarehouse {
  id: string;
  code: string;
  name: string;
  description: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  isActive: boolean;
  compartmentCount: number;
  articleCount: number;
  totalQuantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryWarehouseInput {
  code?: string;
  name?: string;
  description?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  isActive?: boolean;
}

export interface InventoryCompartment {
  id: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  code: string;
  name: string | null;
  description: string | null;
  isActive: boolean;
  articleCount: number;
  totalQuantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryCompartmentInput {
  code?: string;
  name?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export interface InventoryArticle {
  id: string;
  articleNumber: string;
  name: string;
  description: string | null;
  ean: string | null;
  unit: string;
  manufacturer: string | null;
  manufacturerPartNumber: string | null;
  supplierId: string | null;
  supplierArticleNumber: string | null;
  purchasePriceNet: number | null;
  salesPriceNet: number | null;
  currency: string;
  taxCategory: InventoryTaxCategory;
  reorderPoint: number | null;
  reorderQuantity: number | null;
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  isActive: boolean;
  /** Units carry serial numbers (every movement names them). */
  serialTracking: boolean;
  /** Moving weighted average unit cost of the stock on hand (accounting valuation); absent without accounting. */
  averageCost?: number | null;
  totalQuantity: number;
  /** On loan (open lendings); not part of `totalQuantity`. */
  lentQuantity: number;
  locationCount: number;
  requestedQuantity: number;
  lowStock: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryArticleInput {
  name?: string;
  description?: string | null;
  ean?: string | null;
  unit?: string;
  manufacturer?: string | null;
  manufacturerPartNumber?: string | null;
  supplierId?: string | null;
  supplierArticleNumber?: string | null;
  purchasePriceNet?: number | null;
  salesPriceNet?: number | null;
  currency?: string;
  taxCategory?: InventoryTaxCategory;
  reorderPoint?: number | null;
  reorderQuantity?: number | null;
  weightKg?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  hsCode?: string | null;
  countryOfOrigin?: string | null;
  isActive?: boolean;
  /** Only switchable while the article has no stock and nothing is on loan. */
  serialTracking?: boolean;
  /** Create only: locations (quantity > 0 books a putaway; serial-tracked: one serial number per unit). */
  placements?: Array<{ compartmentId: string; quantity?: number; serialNumbers?: string[] }>;
}

export interface InventoryStock {
  id: string;
  quantity: number;
  article: Pick<
    InventoryArticle,
    'id' | 'articleNumber' | 'name' | 'ean' | 'unit' | 'isActive' | 'reorderPoint' | 'serialTracking'
  >;
  compartment: { id: string; code: string; name: string | null; isActive: boolean };
  warehouse: { id: string; code: string; name: string; isActive: boolean };
  updatedAt: string;
}

export interface InventoryMovementLocation {
  warehouseCode: string;
  warehouseName: string;
  compartmentId: string;
  compartmentCode: string;
}

export interface InventoryMovement {
  id: string;
  type: InventoryMovementType;
  documentNumber: string;
  articleId: string;
  articleNumber: string;
  articleName: string;
  unit: string;
  quantity: number;
  reason: InventoryMovementReason | null;
  source: InventoryMovementLocation | null;
  target: InventoryMovementLocation | null;
  sourceQuantityAfter: number | null;
  targetQuantityAfter: number | null;
  reference: string | null;
  note: string | null;
  withdrawalRequestId: string | null;
  serialNumbers: string[];
  lendingId: string | null;
  lending: {
    documentNumber: string | null;
    borrowerName: string;
    borrowerKind: InventoryBorrowerKind;
    dueDate: string | null;
  } | null;
  performedByEmail: string | null;
  hasPdf: boolean;
  createdAt: string;
}

export interface InventoryMovementFilters {
  search?: string;
  type?: InventoryMovementType;
  articleId?: string;
  compartmentId?: string;
  warehouseId?: string;
  requestId?: string;
  lendingId?: string;
  /** Movements of one exact serial number. */
  serialNumber?: string;
}

export interface InventoryPutawayInput {
  articleId: string;
  targetCompartmentId: string;
  quantity: number;
  /** Serial-tracked articles: singles and ranges (`SN-01..SN-20`). */
  serialNumbers?: string[];
  reason?: InventoryMovementReason;
  reference?: string | null;
  note?: string | null;
  /** Supplier invoice the stock was bought with (valuation at its line price). */
  supplierInvoiceId?: string | null;
  /** Unit cost override for valuation (net, functional currency). */
  unitCost?: number | null;
}

export interface InventoryTransferInput {
  articleId: string;
  sourceCompartmentId: string;
  targetCompartmentId: string;
  quantity: number;
  serialNumbers?: string[];
  reference?: string | null;
  note?: string | null;
}

export interface InventoryWithdrawalInput {
  articleId: string;
  sourceCompartmentId: string;
  quantity: number;
  serialNumbers?: string[];
  reason?: InventoryMovementReason;
  reference?: string | null;
  note?: string | null;
}

export interface InventoryWithdrawalRequest {
  id: string;
  status: InventoryWithdrawalRequestStatus;
  sourceType: InventoryWithdrawalRequestSource;
  sourceLabel: string;
  quantity: number;
  article: Pick<InventoryArticle, 'id' | 'articleNumber' | 'name' | 'ean' | 'unit' | 'serialTracking'>;
  availableQuantity: number;
  userId: string | null;
  customerEmail: string | null;
  offerId: string | null;
  invoiceId: string | null;
  subscriptionId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  movementIds: string[];
  createdAt: string;
}

export interface InventoryRequestAllocation {
  compartmentId: string;
  quantity: number;
  serialNumbers?: string[];
}

export interface InventorySerialLocation {
  compartmentId: string;
  compartmentCode: string;
  warehouseCode: string;
  warehouseName: string;
}

export interface InventorySerialUnit {
  id: string;
  serialNumber: string;
  status: InventorySerialUnitStatus;
  article: Pick<InventoryArticle, 'id' | 'articleNumber' | 'name'>;
  location: InventorySerialLocation | null;
  lending: {
    id: string;
    documentNumber: string | null;
    borrowerName: string;
    borrowerKind: InventoryBorrowerKind;
    dueDate: string | null;
  } | null;
  updatedAt: string;
}

export interface InventorySerialUnitFilters {
  articleId?: string;
  status?: InventorySerialUnitStatus;
  compartmentId?: string;
  lendingId?: string;
}

export interface InventoryLending {
  id: string;
  status: InventoryLendingStatus;
  overdue: boolean;
  documentNumber: string | null;
  article: Pick<InventoryArticle, 'id' | 'articleNumber' | 'name' | 'unit' | 'serialTracking'>;
  quantity: number;
  returnedQuantity: number;
  outstandingQuantity: number;
  borrower: {
    userId: string | null;
    name: string;
    email: string | null;
    customerNumber: string | null;
    kind: InventoryBorrowerKind;
  };
  source: InventorySerialLocation | null;
  dueDate: string | null;
  note: string | null;
  outstandingSerialNumbers: string[];
  movementIds: string[];
  createdAt: string;
  returnedAt: string | null;
}

export interface InventoryLendingFilters {
  status?: InventoryLendingStatus;
  overdue?: boolean;
  articleId?: string;
  borrowerUserId?: string;
}

export interface InventoryLendingInput {
  articleId: string;
  sourceCompartmentId: string;
  quantity: number;
  serialNumbers?: string[];
  /** Exactly one of `borrowerUserId` (customer / staff account) and `borrowerName` (employee without account). */
  borrowerUserId?: string;
  borrowerName?: string;
  dueDate?: string | null;
  reference?: string | null;
  note?: string | null;
}

export interface InventoryLendingReturnInput {
  targetCompartmentId: string;
  quantity: number;
  serialNumbers?: string[];
  reference?: string | null;
  note?: string | null;
}

export interface InventoryLabelRequest {
  kinds: InventoryLabelKind[];
  articleIds?: string[];
  serialUnitIds?: string[];
  copies?: number;
  layout?: InventoryLabelLayout;
}

export interface InventorySummary {
  warehouseCount: number;
  compartmentCount: number;
  articleCount: number;
  lowStockArticleCount: number;
  pendingRequestCount: number;
  openLendingCount: number;
  overdueLendingCount: number;
}

/** Per-period plan articles (service plan editor). */
export interface ServicePlanInventoryArticle {
  articleId: string;
  quantity: number;
}

/** Owner printed on property stickers (billing issuer); `name` null when not configured. */
export interface InventoryLabelOwner {
  name: string | null;
  address: string | null;
  contact: string | null;
}
