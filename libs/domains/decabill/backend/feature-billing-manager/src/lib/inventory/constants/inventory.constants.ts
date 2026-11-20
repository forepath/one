/** Stock movement kinds; every movement is a numbered, archived document. */
export enum InventoryMovementType {
  PUTAWAY = 'putaway',
  TRANSFER = 'transfer',
  WITHDRAWAL = 'withdrawal',
  /** Stock leaves its compartment on loan to a person (customer or staff); it stays tracked until returned. */
  LENDING = 'lending',
  /** Lent stock comes back into a compartment. */
  LENDING_RETURN = 'lending_return',
}

/** Document number prefixes (`{prefix}-{year}-{nnnnn}`) and archive sub folders per movement type. */
export const INVENTORY_MOVEMENT_DOCUMENT: Readonly<Record<InventoryMovementType, { prefix: string; folder: string }>> =
  {
    [InventoryMovementType.PUTAWAY]: { prefix: 'PUT', folder: 'putaways' },
    [InventoryMovementType.TRANSFER]: { prefix: 'TRF', folder: 'transfers' },
    [InventoryMovementType.WITHDRAWAL]: { prefix: 'WDR', folder: 'withdrawals' },
    [InventoryMovementType.LENDING]: { prefix: 'LND', folder: 'lendings' },
    [InventoryMovementType.LENDING_RETURN]: { prefix: 'RTN', folder: 'lending-returns' },
  };

/** Movements that take stock out of a compartment / put stock into one. */
export const INVENTORY_MOVEMENTS_WITH_SOURCE: readonly InventoryMovementType[] = [
  InventoryMovementType.TRANSFER,
  InventoryMovementType.WITHDRAWAL,
  InventoryMovementType.LENDING,
];
export const INVENTORY_MOVEMENTS_WITH_TARGET: readonly InventoryMovementType[] = [
  InventoryMovementType.PUTAWAY,
  InventoryMovementType.TRANSFER,
  InventoryMovementType.LENDING_RETURN,
];

/** Where one serial-tracked unit is. */
export enum InventorySerialUnitStatus {
  IN_STOCK = 'in_stock',
  LENT = 'lent',
  /** Withdrawn (sold, consumed, scrapped, lost); a later putaway of the same serial number brings it back. */
  WITHDRAWN = 'withdrawn',
}

export enum InventoryLendingStatus {
  OPEN = 'open',
  RETURNED = 'returned',
}

/** Upper bound of serial numbers one movement may carry (ranges included). */
export const INVENTORY_SERIALS_PER_MOVEMENT_MAX = 1000;

/** Why stock left a compartment (withdrawals) or arrived (putaways). */
export enum InventoryMovementReason {
  /** Putaway: goods received (purchase / delivery). */
  RECEIPT = 'receipt',
  /** Putaway: customer return. */
  RETURN = 'return',
  /** Withdrawal: fulfils a customer request (offer / invoice / subscription). */
  FULFILLMENT = 'fulfillment',
  /** Withdrawal: internal consumption. */
  CONSUMPTION = 'consumption',
  /** Withdrawal: damaged / scrapped goods. */
  DAMAGE = 'damage',
  /** Withdrawal: lost / shrinkage. */
  LOSS = 'loss',
  /** Either direction: stock count correction. */
  CORRECTION = 'correction',
  OTHER = 'other',
}

export const INVENTORY_PUTAWAY_REASONS: readonly InventoryMovementReason[] = [
  InventoryMovementReason.RECEIPT,
  InventoryMovementReason.RETURN,
  InventoryMovementReason.CORRECTION,
  InventoryMovementReason.OTHER,
];

export const INVENTORY_WITHDRAWAL_REASONS: readonly InventoryMovementReason[] = [
  InventoryMovementReason.FULFILLMENT,
  InventoryMovementReason.CONSUMPTION,
  InventoryMovementReason.DAMAGE,
  InventoryMovementReason.LOSS,
  InventoryMovementReason.CORRECTION,
  InventoryMovementReason.OTHER,
];

export enum InventoryWithdrawalRequestStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

/** Where a withdrawal request comes from (requests are created outside the inventory pages only). */
export enum InventoryWithdrawalRequestSource {
  /** Accepted offer line of type `article`. */
  OFFER = 'offer',
  /** Issued invoice line referencing an article. */
  INVOICE = 'invoice',
  /** Issued subscription period invoice; articles configured on the service plan. */
  SUBSCRIPTION = 'subscription',
}

/** Units of measure offered in the article editor (free text is not allowed to keep documents consistent). */
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

export type InventoryArticleUnit = (typeof INVENTORY_ARTICLE_UNITS)[number];

/** Quantities are stored with three decimals (weights, lengths, volumes). */
export const INVENTORY_QUANTITY_SCALE = 3;

/** Upper bound of a single quantity (column numeric(14,3)). */
export const INVENTORY_QUANTITY_MAX = 99_999_999_999;

/** Default and maximum page size of inventory list endpoints. */
export const INVENTORY_DEFAULT_PAGE_SIZE = 25;
export const INVENTORY_MAX_PAGE_SIZE = 100;

/** Printable labels: article number (Code 128), EAN, property sticker with the issuer's company data. */
export const INVENTORY_LABEL_KINDS = ['article_number', 'ean', 'property'] as const;
export type InventoryLabelKind = (typeof INVENTORY_LABEL_KINDS)[number];

/** `sheet`: A4 sheets of 24 labels to cut out (3 x 8, 5 mm margins, 3 mm gaps); `single`: one 70 x 37 mm label per page. */
export const INVENTORY_LABEL_LAYOUTS = ['sheet', 'single'] as const;
export type InventoryLabelLayout = (typeof INVENTORY_LABEL_LAYOUTS)[number];

/** Upper bound of labels one print job renders (synchronous export). */
export const INVENTORY_LABELS_MAX = 1000;
