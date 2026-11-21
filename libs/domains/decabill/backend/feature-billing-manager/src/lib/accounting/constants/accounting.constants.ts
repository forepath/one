/** Account classes (drive statement placement, normal balance and year-end closing). */
export enum AccountingAccountType {
  ASSET = 'asset',
  LIABILITY = 'liability',
  EQUITY = 'equity',
  REVENUE = 'revenue',
  EXPENSE = 'expense',
  /** Statistical / carry-forward accounts (e.g. DATEV 9000 Saldenvorträge); excluded from statements. */
  STATISTICAL = 'statistical',
}

export const BALANCE_SHEET_ACCOUNT_TYPES: AccountingAccountType[] = [
  AccountingAccountType.ASSET,
  AccountingAccountType.LIABILITY,
  AccountingAccountType.EQUITY,
];

export const PROFIT_AND_LOSS_ACCOUNT_TYPES: AccountingAccountType[] = [
  AccountingAccountType.REVENUE,
  AccountingAccountType.EXPENSE,
];

/**
 * System roles let posting rules find accounts independent of the chart's numbering. A chart assigns each role to
 * exactly one account (roles are optional per chart; posting fails with a clear error when a needed role is unmapped).
 */
export enum AccountingAccountRole {
  RECEIVABLES = 'receivables',
  PAYABLES = 'payables',
  BANK = 'bank',
  CASH = 'cash',
  CASH_IN_TRANSIT = 'cash_in_transit',
  PROCESSOR_CLEARING = 'processor_clearing',
  CUSTOMER_PREPAYMENTS = 'customer_prepayments',
  REVENUE_STANDARD = 'revenue_standard',
  REVENUE_REDUCED = 'revenue_reduced',
  REVENUE_TAX_FREE = 'revenue_tax_free',
  REVENUE_EU_REVERSE_CHARGE = 'revenue_eu_reverse_charge',
  REVENUE_OSS = 'revenue_oss',
  REVENUE_THIRD_COUNTRY = 'revenue_third_country',
  REVENUE_REDUCTIONS = 'revenue_reductions',
  CASH_DISCOUNTS_GRANTED = 'cash_discounts_granted',
  CASH_DISCOUNTS_RECEIVED = 'cash_discounts_received',
  VAT_OUTPUT_STANDARD = 'vat_output_standard',
  VAT_OUTPUT_REDUCED = 'vat_output_reduced',
  VAT_OUTPUT_OSS = 'vat_output_oss',
  VAT_OUTPUT_REVERSE_CHARGE = 'vat_output_reverse_charge',
  VAT_INPUT_STANDARD = 'vat_input_standard',
  VAT_INPUT_REDUCED = 'vat_input_reduced',
  VAT_INPUT_REVERSE_CHARGE = 'vat_input_reverse_charge',
  VAT_PREPAYMENTS = 'vat_prepayments',
  VAT_SETTLEMENT = 'vat_settlement',
  EXPENSE_DEFAULT = 'expense_default',
  EXPENSE_REVERSE_CHARGE_EU = 'expense_reverse_charge_eu',
  EXPENSE_REVERSE_CHARGE_THIRD_COUNTRY = 'expense_reverse_charge_third_country',
  PAYMENT_FEES = 'payment_fees',
  BAD_DEBT = 'bad_debt',
  INVENTORY = 'inventory',
  COST_OF_GOODS_SOLD = 'cost_of_goods_sold',
  FIXED_ASSETS = 'fixed_assets',
  LOW_VALUE_ASSETS = 'low_value_assets',
  ASSET_POOL = 'asset_pool',
  DEPRECIATION = 'depreciation',
  ASSET_DISPOSAL_GAIN = 'asset_disposal_gain',
  ASSET_DISPOSAL_LOSS = 'asset_disposal_loss',
  FX_GAIN = 'fx_gain',
  FX_LOSS = 'fx_loss',
  ROUNDING = 'rounding',
  SUSPENSE = 'suspense',
  OWNER_DRAWINGS = 'owner_drawings',
  OWNER_CONTRIBUTIONS = 'owner_contributions',
  RETAINED_EARNINGS = 'retained_earnings',
  ANNUAL_RESULT = 'annual_result',
  OPENING_BALANCE = 'opening_balance',
  OPENING_BALANCE_RECEIVABLES = 'opening_balance_receivables',
  OPENING_BALANCE_PAYABLES = 'opening_balance_payables',
}

export enum AccountingMethod {
  /** Double entry with balance sheet and P&L (HGB Bilanz, PCG, IFRS …). */
  ACCRUAL = 'accrual',
  /** Cash-basis profit (EÜR §4 Abs. 3 EStG and equivalents); journal kept double entry, reports by payment date. */
  CASH = 'cash',
}

export enum VatBasis {
  /** VAT due when invoiced (Soll-Versteuerung). */
  INVOICE = 'invoice',
  /** VAT due when paid (Ist-Versteuerung). */
  PAYMENT = 'payment',
}

export enum FiscalYearStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

export enum AccountingPeriodStatus {
  OPEN = 'open',
  /** Festschreibung: no new postings, entries immutable (corrections go into an open period). */
  LOCKED = 'locked',
}

export enum JournalEntryKind {
  /** Generated from a business document or event. */
  AUTOMATIC = 'automatic',
  MANUAL = 'manual',
  OPENING = 'opening',
  CLOSING = 'closing',
  REVERSAL = 'reversal',
  DEPRECIATION = 'depreciation',
  VAT_SETTLEMENT = 'vat_settlement',
}

/** Business sources of automatic postings (with event, the idempotency key). */
export enum JournalSourceType {
  INVOICE = 'invoice',
  CREDIT_DOCUMENT = 'credit_document',
  VOID_DOCUMENT = 'void_document',
  SETTLEMENT = 'settlement',
  SUPPLIER_INVOICE = 'supplier_invoice',
  BANK_TRANSACTION = 'bank_transaction',
  PROCESSOR_TRANSACTION = 'processor_transaction',
  INVENTORY_MOVEMENT = 'inventory_movement',
  FIXED_ASSET = 'fixed_asset',
  VAT_RETURN = 'vat_return',
  FISCAL_YEAR = 'fiscal_year',
  MANUAL = 'manual',
  OPENING_BALANCE = 'opening_balance',
}

export enum JournalLinkType {
  INVOICE = 'invoice',
  CREDIT_DOCUMENT = 'credit_document',
  VOID_DOCUMENT = 'void_document',
  SUPPLIER_INVOICE = 'supplier_invoice',
  SETTLEMENT = 'settlement',
  PAYMENT_ATTEMPT = 'payment_attempt',
  PAYMENT_REFUND = 'payment_refund',
  BANK_TRANSACTION = 'bank_transaction',
  PROCESSOR_TRANSACTION = 'processor_transaction',
  INVENTORY_MOVEMENT = 'inventory_movement',
  FIXED_ASSET = 'fixed_asset',
  OFFER = 'offer',
  PROJECT = 'project',
  SUBSCRIPTION = 'subscription',
  STORED_FILE = 'stored_file',
  VAT_RETURN = 'vat_return',
  JOURNAL_ENTRY = 'journal_entry',
}

export const JOURNAL_LINK_TYPES = Object.values(JournalLinkType);

export enum JournalLinkRole {
  SOURCE = 'source',
  RECEIPT = 'receipt',
  SETTLES = 'settles',
  RELATED = 'related',
}

export enum CounterpartyType {
  CUSTOMER = 'customer',
  SUPPLIER = 'supplier',
}

/** Tax code kinds drive VAT account selection and VAT return boxes. */
export enum TaxCodeKind {
  OUTPUT = 'output',
  INPUT = 'input',
  /** Recipient owes VAT (§13b): input and output in one posting. */
  REVERSE_CHARGE = 'reverse_charge',
  /** Non-taxable / exempt supplies reported in a box without tax. */
  EXEMPT = 'exempt',
}

export const ACCOUNTING_MONEY_SCALE = 2;
