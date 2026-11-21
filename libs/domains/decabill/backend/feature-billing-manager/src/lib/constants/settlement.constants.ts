/** Kind of document a settlement belongs to. */
export enum SettlementDocumentType {
  INVOICE = 'invoice',
  SUPPLIER_INVOICE = 'supplier_invoice',
}

/**
 * Settlement kinds. `amount` is always positive; the effect on the open balance follows from the kind:
 * reducing kinds lower the balance due, increasing kinds raise it again.
 */
export enum SettlementType {
  /** Cash received (customer) / paid (supplier). */
  PAYMENT = 'payment',
  /** Payment taken back (chargeback, return debit, manual "mark unpaid"). */
  PAYMENT_REVERSAL = 'payment_reversal',
  /** Partial credit note / supplier credit applied to the document. */
  CREDIT = 'credit',
  /** Money paid back to the customer (or refunded by the supplier) from an overpayment or credit. */
  REFUND = 'refund',
  /** Uncollectible receivable written off (Forderungsverlust). */
  WRITE_OFF = 'write_off',
  /** Cash discount (Skonto) granted / received. */
  DISCOUNT = 'discount',
  /** Customer credit (negative balance of another document) applied to this document. */
  CREDIT_TRANSFER_IN = 'credit_transfer_in',
  /** Customer credit of this document moved to another document. */
  CREDIT_TRANSFER_OUT = 'credit_transfer_out',
}

export const BALANCE_REDUCING_SETTLEMENT_TYPES: SettlementType[] = [
  SettlementType.PAYMENT,
  SettlementType.CREDIT,
  SettlementType.WRITE_OFF,
  SettlementType.DISCOUNT,
  SettlementType.CREDIT_TRANSFER_IN,
];

export const BALANCE_INCREASING_SETTLEMENT_TYPES: SettlementType[] = [
  SettlementType.PAYMENT_REVERSAL,
  SettlementType.REFUND,
  SettlementType.CREDIT_TRANSFER_OUT,
];

/** Where a settlement came from. */
export enum SettlementSource {
  PROCESSOR_WEBHOOK = 'processor_webhook',
  AUTO_CHARGE = 'auto_charge',
  MANUAL = 'manual',
  BANK_MATCH = 'bank_match',
  PROCESSOR_SYNC = 'processor_sync',
  CREDIT_DOCUMENT = 'credit_document',
  CUSTOMER_CREDIT = 'customer_credit',
  PROMOTIONAL = 'promotional',
  MIGRATION = 'migration',
}
