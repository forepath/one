/**
 * Accounting (financial bookkeeping) API types: `/admin/billing/accounting/...`. Amounts are numbers in functional
 * currency unless noted; columns stored as numeric strings by the API are typed `number | string`.
 */

export type AccountingAccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'statistical';
export type AccountingMethod = 'accrual' | 'cash';
export type AccountingVatBasis = 'invoice' | 'payment';
export type AccountingFiscalYearStatus = 'open' | 'closed';
export type AccountingPeriodStatus = 'open' | 'locked';
export type AccountingEntryKind =
  | 'automatic'
  | 'manual'
  | 'opening'
  | 'closing'
  | 'reversal'
  | 'depreciation'
  | 'vat_settlement';
export type AccountingSourceType =
  | 'invoice'
  | 'credit_document'
  | 'void_document'
  | 'settlement'
  | 'supplier_invoice'
  | 'bank_transaction'
  | 'processor_transaction'
  | 'inventory_movement'
  | 'fixed_asset'
  | 'vat_return'
  | 'fiscal_year'
  | 'manual'
  | 'opening_balance';
export type AccountingLinkType =
  | 'invoice'
  | 'credit_document'
  | 'void_document'
  | 'supplier_invoice'
  | 'settlement'
  | 'payment_attempt'
  | 'payment_refund'
  | 'bank_transaction'
  | 'processor_transaction'
  | 'inventory_movement'
  | 'fixed_asset'
  | 'offer'
  | 'project'
  | 'subscription'
  | 'stored_file'
  | 'vat_return'
  | 'journal_entry';
export type AccountingLinkRole = 'source' | 'receipt' | 'settles' | 'related';
export type AccountingTaxCodeKind = 'output' | 'input' | 'reverse_charge' | 'exempt';
export type AccountingCounterpartyType = 'customer' | 'supplier';
export type AccountingExportKind =
  | 'datev'
  | 'gdpdu'
  | 'fec'
  | 'saft'
  | 'journal_csv'
  | 'trial_balance_csv'
  | 'xaf'
  | 'sie';
/** Export kinds the API serves at `GET /exports`. */
export type AccountingDownloadableExportKind = 'journal_csv' | 'trial_balance_csv' | 'gdpdu' | 'fec' | 'saft' | 'xaf';
export type AccountingStatementKind = 'balance_sheet' | 'profit_and_loss' | 'cash_basis';
export type AccountingVatReturnStatus = 'draft' | 'submitted' | 'paid';
export type AccountingVatPeriod = 'month' | 'quarter' | 'year';
export type AccountingFinancialAccountKind = 'bank' | 'cash' | 'processor' | 'other';
export type AccountingBankImportStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'rolled_back';
export type AccountingBankMatchStatus = 'unmatched' | 'suggested' | 'matched' | 'booked' | 'ignored' | 'superseded';
export type AccountingBankImportFormat =
  | 'camt.052'
  | 'camt.053'
  | 'camt.054'
  | 'mt940'
  | 'mt942'
  | 'coda'
  | 'norma43'
  | 'cfonb120'
  | 'cbi-rh'
  | 'bai2'
  | 'ofx'
  | 'qif'
  | 'csv';
export type AccountingImportEncoding = 'auto' | 'utf-8' | 'windows-1252' | 'iso-8859-1' | 'cp850';
export type AccountingQifDateFormat = 'DMY' | 'MDY' | 'auto';
export type AccountingFixedAssetMethod = 'straight_line' | 'immediate' | 'pool';
export type AccountingFixedAssetStatus = 'active' | 'fully_depreciated' | 'disposed';
export type AccountingMatchRuleKind = 'iban' | 'text';
export type AccountingMatchRuleTargetType = 'customer' | 'supplier' | 'account';

export interface AccountingPage<T> {
  items: T[];
  total: number;
}

/** `viewTenantId`: another tenant (global views only) or `all`; omitted = the request tenant. */
export interface AccountingViewParams {
  viewTenantId?: string | null;
}

export interface AccountingDateRange {
  from: string;
  to: string;
}

// ---- Overview / profile ----

export interface AccountingVatReturnSummary {
  key: string;
  name: string;
  kind: AccountingVatReturnDefinition['kind'];
  periods: AccountingVatPeriod[];
  filingChannel: string;
  filingUrl?: string;
  dueRule: string;
}

export interface AccountingFeatureAvailability {
  key: string;
  available: boolean;
  /** Missing environment variables. */
  missing: string[];
}

export interface AccountingOverview {
  enabled: boolean;
  country: string;
  profile: {
    country: string;
    name: string;
    templates: string[];
    defaultTemplate: string;
    vatReturns: AccountingVatReturnSummary[];
    exports: AccountingExportKind[];
    hasCashBasis: boolean;
    retention: { booksYears: number; vouchersYears: number };
    complianceNotice: string | null;
    mandatoryChart: boolean;
  };
  method: AccountingMethod;
  vatBasis: AccountingVatBasis;
  startDate: string;
  fiscalYearStartMonth: number;
  functionalCurrency: string;
  vatReturnPeriod: string | null;
  features: AccountingFeatureAvailability[];
  fiscalYears: AccountingFiscalYear[];
  /** Null for tenant-scoped viewers (posting issues are entity-wide). */
  openPostingIssues: number | null;
  globalAccess: boolean;
  tenantFilter: string | null;
}

// ---- Charts / accounts / tax codes ----

export interface AccountingChartTemplate {
  key: string;
  country: string | null;
  name: string;
  description: string;
  source: string;
  accountCount: number;
  taxCodeCount: number;
}

export interface AccountingChart {
  id: string;
  code: string;
  name: string;
  country?: string | null;
  templateKey?: string | null;
  accountLength: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAccountingChartDto {
  templateKey?: string;
  code?: string;
  name?: string;
  country?: string;
  accountLength?: number;
}

export interface AccountingAccount {
  id: string;
  chartId: string;
  number: string;
  name: string;
  type: AccountingAccountType;
  role?: string | null;
  statementPosition?: string | null;
  isAutomatic: boolean;
  defaultTaxCodeId?: string | null;
  isActive: boolean;
  isTemplate: boolean;
  description?: string | null;
  externalCodes?: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingAccountInput {
  number: string;
  name: string;
  type: AccountingAccountType;
  role?: string | null;
  statementPosition?: string | null;
  isAutomatic?: boolean;
  defaultTaxCodeId?: string | null;
  isActive?: boolean;
  description?: string | null;
  externalCodes?: Record<string, string> | null;
}

export interface AccountingAccountImportResult {
  created: number;
  updated: number;
  skipped: number;
}

export interface AccountingTaxCode {
  id: string;
  chartId: string;
  code: string;
  name: string;
  kind: AccountingTaxCodeKind;
  rate?: number | string | null;
  accountId?: string | null;
  reverseAccountId?: string | null;
  baseBox?: string | null;
  taxBox?: string | null;
  reverseTaxBox?: string | null;
  ecSalesList: boolean;
  oss: boolean;
  datevBuKey?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingTaxCodeInput {
  code: string;
  name: string;
  kind: AccountingTaxCodeKind;
  rate?: number | null;
  accountId?: string | null;
  reverseAccountId?: string | null;
  baseBox?: string | null;
  taxBox?: string | null;
  reverseTaxBox?: string | null;
  ecSalesList?: boolean;
  oss?: boolean;
  datevBuKey?: string | null;
  isActive?: boolean;
}

export type AccountingTaxCodeUpdate = Partial<Omit<AccountingTaxCodeInput, 'code' | 'kind'>>;

// ---- Fiscal years / periods / closing ----

export interface AccountingPeriod {
  id: string;
  fiscalYearId: string;
  periodIndex: number;
  startDate: string;
  endDate: string;
  status: AccountingPeriodStatus;
  lockedAt?: string | null;
  lockedByUserId?: string | null;
}

export interface AccountingFiscalYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  chartId: string;
  status: AccountingFiscalYearStatus;
  closedAt?: string | null;
  closedByUserId?: string | null;
  createdAt: string;
  /** Present on `GET /fiscal-years`. */
  periods?: AccountingPeriod[];
}

export interface AccountingOpenFiscalYearDto {
  chartId?: string;
  endDate?: string;
}

export interface AccountingCloseYearDto {
  nextChartId?: string;
  /** Old account number → new account number. */
  accountMapping?: Record<string, string>;
}

export interface AccountingClosePreview {
  fiscalYear: AccountingFiscalYear;
  targetChartId: string;
  chartChanges: boolean;
  result: number;
  balances: Array<{ number: string; name: string; balance: number; targetNumber: string | null }>;
  unmapped: string[];
}

// ---- FX / posting issues ----

export interface AccountingFxRate {
  id: string;
  currency: string;
  rateDate: string;
  rate: number | string;
  source: 'ecb' | 'manual';
  createdByUserId?: string | null;
  createdAt: string;
}

export interface AccountingFxRateParams {
  currency?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AccountingFxRateInput {
  currency: string;
  rateDate: string;
  rate: number;
}

export interface AccountingPostingIssue {
  id: string;
  idempotencyKey: string;
  sourceType: AccountingSourceType;
  sourceId: string;
  /** Document number of the source (e.g. the invoice number), when known. */
  sourceLabel?: string | null;
  sourceEvent: string;
  tenantId?: string | null;
  error: string;
  attempts: number;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingCatchUpResult {
  invoicesIssued?: number;
  invoicesVoided?: number;
  creditDocuments?: number;
  settlements?: number;
  supplierInvoicesIssued?: number;
  supplierInvoicesVoided?: number;
  openingItems?: number;
  skipped?: boolean;
}

// ---- Journal ----

export interface AccountingJournalLine {
  id: string;
  entryId: string;
  lineNo: number;
  accountId: string;
  debit: number | string;
  credit: number | string;
  originalAmount?: number | string | null;
  originalCurrency?: string | null;
  taxCodeId?: string | null;
  taxRate?: number | string | null;
  taxRole?: 'base' | 'tax' | 'reverse_tax' | null;
  counterpartyType?: AccountingCounterpartyType | null;
  counterpartyId?: string | null;
  /** Customer / supplier number and name (entry detail). */
  counterpartyLabel?: string | null;
  openItemId?: string | null;
  tenantId?: string | null;
  costCenter?: string | null;
  description?: string | null;
  serviceDate?: string | null;
  euCountry?: string | null;
  euVatId?: string | null;
  /** Some responses embed the account. */
  account?: Pick<AccountingAccount, 'id' | 'number' | 'name'> | null;
}

export interface AccountingEntryLink {
  id: string;
  entryId: string;
  linkType: AccountingLinkType;
  targetId: string;
  /** Document number of the target (e.g. the invoice number), when known. */
  targetLabel?: string | null;
  role: AccountingLinkRole;
  label?: string | null;
  createdByUserId?: string | null;
  createdAt: string;
}

export interface AccountingJournalEntry {
  id: string;
  fiscalYearId: string;
  periodId: string;
  entryNumber: number;
  postingDate: string;
  documentDate: string;
  documentNumber?: string | null;
  description: string;
  kind: AccountingEntryKind;
  sourceType: AccountingSourceType;
  sourceId?: string | null;
  sourceEvent?: string | null;
  tenantId?: string | null;
  currency: string;
  fxRate: number | string;
  total: number | string;
  reversalOfEntryId?: string | null;
  reversedByEntryId?: string | null;
  createdByUserId?: string | null;
  createdAt: string;
  lines?: AccountingJournalLine[];
  /** Present on the entry detail. */
  links?: AccountingEntryLink[];
}

export interface AccountingJournalFilters {
  from?: string;
  to?: string;
  accountId?: string;
  sourceType?: string;
  kind?: string;
  search?: string;
}

export interface AccountingJournalListParams extends AccountingJournalFilters {
  limit?: number;
  offset?: number;
}

export interface AccountingJournalStatistics {
  kpis: {
    entries: number;
    /** 0..1 */
    manualShare: number;
    volume: number;
    revenue: number;
    expenses: number;
    result: number;
  };
  series: Array<{ bucket: string; entries: number; volume: number; manual: number }>;
  result: Array<{ month: string; revenue: number; expenses: number }>;
  bySource: Array<{ source: string; entries: number; volume: number }>;
}

export interface AccountingJournalLinkInput {
  linkType: AccountingLinkType;
  /** Document number (or id) of the target; the server resolves numbers within the entry's tenant. */
  targetId: string;
  role?: Exclude<AccountingLinkRole, 'source'>;
  label?: string;
}

export interface AccountingManualEntryLine {
  accountNumber: string;
  debit?: number;
  credit?: number;
  /** Lines with a tax code are entered gross; the VAT line is split off automatically. */
  taxCode?: string;
  description?: string;
  costCenter?: string;
}

export interface AccountingManualEntryInput {
  documentDate: string;
  documentNumber?: string;
  description: string;
  tenantId?: string;
  lines: AccountingManualEntryLine[];
  links?: AccountingJournalLinkInput[];
}

export interface AccountingReverseEntryInput {
  documentDate?: string;
  reason?: string;
}

// ---- Reports ----

export interface AccountingTrialBalanceRow {
  accountId: string;
  number: string;
  name: string;
  type: AccountingAccountType;
  statementPosition: string | null;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

export interface AccountingLedgerItem {
  entryId: string;
  entryNumber: number;
  postingDate: string;
  documentDate: string;
  documentNumber: string | null;
  description: string;
  sourceType: AccountingSourceType;
  kind: AccountingEntryKind;
  debit: number;
  credit: number;
  counterpartyType: AccountingCounterpartyType | null;
  counterpartyId: string | null;
  tenantId: string | null;
  taxRate: number | null;
  lineDescription: string | null;
  running: number;
}

export interface AccountingLedger {
  account: AccountingAccount;
  opening: number;
  items: AccountingLedgerItem[];
  total: number;
  closing: number;
}

export interface AccountingLedgerParams extends AccountingDateRange {
  accountId: string;
  limit?: number;
  offset?: number;
}

export interface AccountingOpenItemRow {
  openItemId: string;
  counterpartyId: string | null;
  /** Customer / supplier number and name. */
  counterpartyLabel?: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  dueDate: string | null;
  amount: number;
  open: number;
  daysOverdue: number;
  tenantId: string | null;
}

/** Aging bucket keys: `current`, `1-30`, `31-60`, `61-90`, `90+`. */
export interface AccountingOpenItems {
  items: AccountingOpenItemRow[];
  aging: Record<string, number>;
  total: number;
}

export interface AccountingStatementNode {
  code: string;
  label: string;
  amount: number;
  previousAmount?: number;
  accounts: Array<{ number: string; name: string; amount: number }>;
  children: AccountingStatementNode[];
}

export interface AccountingStatement {
  layoutKey: string;
  name: string;
  from: string;
  to: string;
  sections: Array<{ key: string; label: string; nodes: AccountingStatementNode[]; total: number }>;
  result: number;
  unassigned: Array<{ number: string; name: string; amount: number }>;
}

export interface AccountingStatementParams extends AccountingDateRange {
  kind: AccountingStatementKind;
}

// ---- VAT returns ----

export interface AccountingVatReturnBox {
  box: string;
  label: string;
  kind: 'base' | 'tax' | 'computed' | 'manual';
  formula?: string;
  roundDown?: boolean;
}

export interface AccountingVatReturnDefinition {
  key: string;
  name: string;
  kind: 'periodic' | 'annual' | 'ec_sales_list' | 'oss';
  periods: AccountingVatPeriod[];
  boxes: AccountingVatReturnBox[];
  resultBox?: string;
  filingChannel: string;
  filingUrl?: string;
  dueRule: string;
}

export interface AccountingVatReturn {
  id: string;
  definitionKey: string;
  periodStart: string;
  periodEnd: string;
  status: AccountingVatReturnStatus;
  vatBasis: string;
  figures: Record<string, number>;
  /** EC sales list / OSS detail rows (country, VAT id, base, tax …). */
  details: Array<Record<string, unknown>>;
  manualValues: Record<string, number>;
  resultAmount?: number | string | null;
  computedAt: string;
  submittedAt?: string | null;
  submittedByUserId?: string | null;
  filingReference?: string | null;
  paymentEntryId?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingVatReturnListParams {
  definitionKey?: string;
  limit?: number;
  offset?: number;
}

export interface AccountingVatStatistics {
  kpis: { returns: number; drafts: number; submitted: number; paid: number; payableTotal: number };
  series: Array<{ key: string; period: string; result: number; status: AccountingVatReturnStatus }>;
}

export interface AccountingComputeVatReturnInput {
  definitionKey: string;
  periodStart: string;
  periodEnd: string;
  manualValues?: Record<string, number>;
}

export interface AccountingSubmitVatReturnInput {
  filingReference?: string;
  note?: string;
}

export interface AccountingPayVatReturnInput {
  date: string;
  amount?: number;
}

// ---- Banking ----

export interface AccountingFinancialAccount {
  id: string;
  tenantId?: string | null;
  name: string;
  kind: AccountingFinancialAccountKind;
  iban?: string | null;
  accountNumber?: string | null;
  bic?: string | null;
  currency: string;
  ledgerAccountNumber: string;
  processor?: string | null;
  lastClosingBalance?: number | string | null;
  lastClosingDate?: string | null;
  lastSyncedAt?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingFinancialAccountInput {
  name: string;
  kind: AccountingFinancialAccountKind;
  iban?: string | null;
  accountNumber?: string | null;
  bic?: string | null;
  currency: string;
  ledgerAccountNumber: string;
  processor?: 'stripe' | 'paypal' | 'mollie' | 'adyen' | null;
  /** `null` = shared (global views only). */
  tenantId?: string | null;
  isActive?: boolean;
}

export interface AccountingBankImport {
  id: string;
  tenantId?: string | null;
  financialAccountId?: string | null;
  fileName: string;
  fileSize: number;
  format?: string | null;
  formatVersion?: string | null;
  encoding?: string | null;
  csvMapping?: string | null;
  status: AccountingBankImportStatus;
  statementCount: number;
  transactionCount: number;
  duplicateCount: number;
  matchedCount: number;
  warnings: string[];
  errorMessage?: string | null;
  uploadedByUserId?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface AccountingBankImportUpload {
  file: File;
  financialAccountId?: string;
  format?: AccountingBankImportFormat;
  csvPreset?: string;
  csvMappingId?: string;
  encoding?: AccountingImportEncoding;
  qifDateFormat?: AccountingQifDateFormat;
}

export type AccountingMatchTarget =
  /** `id` from suggestions; `number` when entered by hand (resolved within the bank account's tenant). */
  | { type: 'invoice' | 'supplier_invoice'; id?: string; number?: string; amount: number }
  | { type: 'account'; accountNumber: string; amount: number; taxCode?: string | null; description?: string | null };

export interface AccountingMatchSuggestion {
  targets: AccountingMatchTarget[];
  score: number;
  reasons: string[];
  label?: string;
}

export interface AccountingBankTransaction {
  id: string;
  financialAccountId: string;
  importId: string;
  statementId?: string | null;
  tenantId?: string | null;
  status: 'booked' | 'pending' | 'info';
  bookingDate: string;
  valueDate?: string | null;
  amount: number | string;
  currency: string;
  isReversal: boolean;
  counterpartyName?: string | null;
  counterpartyIban?: string | null;
  counterpartyBic?: string | null;
  remittance?: string | null;
  endToEndId?: string | null;
  structuredReference?: string | null;
  bookingText?: string | null;
  bankReference?: string | null;
  bankTransactionCode?: string | null;
  /** File format the line came from (`camt.053`, `mt940`, …; `api` for processor sync). */
  sourceFormat?: string | null;
  matchStatus: AccountingBankMatchStatus;
  /** Line this one was replaced by (pending → booked) or duplicates (same booking from another file format). */
  supersededById?: string | null;
  /** Best stored suggestion (shape of {@link AccountingMatchSuggestion}). */
  suggestion?: Partial<AccountingMatchSuggestion> | null;
  journalEntryId?: string | null;
  matchedByUserId?: string | null;
  matchedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingBankTransactionFilters {
  financialAccountId?: string;
  matchStatus?: AccountingBankMatchStatus;
  importId?: string;
  search?: string;
}

export interface AccountingBankTransactionParams extends AccountingBankTransactionFilters {
  limit?: number;
  offset?: number;
}

export interface AccountingMatchInput {
  targets: Array<{
    type: 'invoice' | 'supplier_invoice' | 'account';
    id?: string;
    accountNumber?: string;
    amount: number;
    taxCode?: string;
    description?: string;
  }>;
  /** Remember the counterparty → customer / supplier / account. */
  learn?: boolean;
}

export interface AccountingBankStatistics {
  kpis: { accounts: number; transactions: number; reconciliationRate: number; unmatched: number; balance: number };
  flows: Array<{ month: string; inflow: number; outflow: number; count: number }>;
  statuses: Array<{ status: AccountingBankMatchStatus; count: number; amount: number }>;
  balances: Array<{ id: string; name: string; currency: string; balance: number | null; date: string | null }>;
}

/** CSV column mapping of a bank export (see the backend `CsvColumnMapping`). */
export interface AccountingCsvColumnMapping {
  delimiter: ';' | ',' | '\t' | '|' | 'auto';
  decimalSeparator: '.' | ',';
  thousandsSeparator?: '.' | ',' | ' ' | "'" | '';
  dateFormat: string;
  encoding: 'auto' | 'utf-8' | 'windows-1252' | 'iso-8859-1';
  skipLines?: number;
  hasHeader: boolean;
  columns: Record<string, string | number | string[] | Array<string | number> | undefined>;
  defaultCurrency?: string;
  invertSign?: boolean;
  processorProvider?: string;
}

export interface AccountingCsvPreset {
  key: string;
  label: string;
  mapping: AccountingCsvColumnMapping;
}

export interface AccountingCsvMapping {
  id: string;
  tenantId?: string | null;
  name: string;
  mapping: AccountingCsvColumnMapping;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingCsvMappingInput {
  name: string;
  mapping: AccountingCsvColumnMapping | Record<string, unknown>;
}

export interface AccountingMatchRule {
  id: string;
  kind: AccountingMatchRuleKind;
  pattern: string;
  targetType: AccountingMatchRuleTargetType;
  targetId: string;
  /** Customer / supplier number and name, or the account number. */
  targetLabel?: string | null;
  taxCode?: string | null;
  hits: number;
  createdByUserId?: string | null;
  createdAt: string;
}

export interface AccountingMatchRuleInput {
  kind: AccountingMatchRuleKind;
  pattern: string;
  targetType: AccountingMatchRuleTargetType;
  /** Customer / supplier number (or id), or the account number. */
  targetId: string;
  taxCode?: string;
}

export type AccountingProcessorSyncResult = Array<{ accountId: string; imported: number; error?: string }>;

// ---- Fixed assets ----

export interface AccountingFixedAsset {
  id: string;
  tenantId?: string | null;
  assetNumber: string;
  name: string;
  acquisitionDate: string;
  acquisitionCost: number | string;
  method: AccountingFixedAssetMethod;
  usefulLifeMonths: number;
  assetAccountNumber: string;
  residualValue: number | string;
  accumulatedDepreciation: number | string;
  depreciatedThrough?: string | null;
  status: AccountingFixedAssetStatus;
  supplierInvoiceId?: string | null;
  supplierInvoiceLineId?: string | null;
  disposalDate?: string | null;
  disposalProceeds?: number | string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountingFixedAssetDetail extends AccountingFixedAsset {
  /** Remaining planned depreciation per month (`YYYY-MM`). */
  plan: Array<{ month: string; amount: number }>;
}

export interface AccountingFixedAssetInput {
  name: string;
  acquisitionDate: string;
  acquisitionCost: number;
  method?: AccountingFixedAssetMethod;
  usefulLifeMonths?: number;
  assetAccountNumber?: string;
  residualValue?: number;
  note?: string;
}

export interface AccountingFixedAssetParams {
  status?: AccountingFixedAssetStatus;
  /** Asset number or name contains. */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AccountingAssetScheduleRow {
  id: string;
  assetNumber: string;
  name: string;
  accountNumber: string;
  method: AccountingFixedAssetMethod;
  acquisitionDate: string;
  openingCost: number;
  additions: number;
  disposals: number;
  closingCost: number;
  openingDepreciation: number;
  depreciation: number;
  openingBookValue: number;
  closingBookValue: number;
}

export interface AccountingDisposeAssetInput {
  date: string;
  note?: string;
}

export interface AccountingDepreciationRunResult {
  assets: number;
  amount: number;
}
