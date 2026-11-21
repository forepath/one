import type { AccountingAccountRole, AccountingAccountType, TaxCodeKind } from '../constants/accounting.constants';

/**
 * Canonical tax codes every template should define (posting rules pick them from the frozen invoice tax snapshot).
 * Templates may add more (custom rates, country specifics); admins can edit all of them.
 */
export enum CanonicalTaxCode {
  /** Domestic standard rate (DE 19 %, FR 20 %, …). */
  OUT_STANDARD = 'OUT_STD',
  /** Domestic reduced rate (DE 7 %, FR 10 % / 5.5 %, …). */
  OUT_REDUCED = 'OUT_RED',
  /** Second reduced rate where a country has one. */
  OUT_REDUCED_2 = 'OUT_RED2',
  /** Tax-free with input VAT deduction (exports of goods, intra-EU goods supplies). */
  OUT_ZERO = 'OUT_ZERO',
  /** EU B2B services, recipient owes VAT (DE Kz 21 + ZM). */
  OUT_EU_REVERSE_CHARGE = 'OUT_EU_RC',
  /** EU B2C e-services taxed in the customer's member state (OSS return). Rate comes from the document line. */
  OUT_OSS = 'OUT_OSS',
  /** Services to third countries, place of supply abroad (DE Kz 45). */
  OUT_EXPORT_SERVICES = 'OUT_EXPORT',
  /** Not taxable here for other reasons (non-EU issuer selling into the EU, …). */
  OUT_NON_TAXABLE = 'OUT_NONTAX',
  /** Input VAT, standard rate. */
  IN_STANDARD = 'IN_STD',
  /** Input VAT, reduced rate. */
  IN_REDUCED = 'IN_RED',
  /** Purchases without VAT (small suppliers, exempt services). */
  IN_NONE = 'IN_NONE',
  /** Services from EU suppliers, reverse charge (DE §13b: Kz 46/47 + 67). */
  RC_EU_SERVICES = 'RC_EU_SRV',
  /** Services from non-EU suppliers, reverse charge (DE §13b: Kz 84/85 + 67). */
  RC_THIRD_COUNTRY = 'RC_3RD_SRV',
}

export interface ChartTemplateAccount {
  number: string;
  name: string;
  type: AccountingAccountType;
  role?: AccountingAccountRole;
  /** Statement position code of the profile's statement layouts. */
  statementPosition?: string;
  /** Automatic VAT account (DATEV Automatikkonto) with this tax code (canonical or template code). */
  automaticTaxCode?: string;
  externalCodes?: Record<string, string>;
}

export interface ChartTemplateTaxCode {
  code: string;
  name: string;
  kind: TaxCodeKind;
  /** Percent; `null` = take the document line's rate (OSS). */
  rate: number | null;
  /** VAT account by role (preferred) or account number. */
  accountRole?: AccountingAccountRole;
  reverseAccountRole?: AccountingAccountRole;
  baseBox?: string;
  taxBox?: string;
  reverseTaxBox?: string;
  ecSalesList?: boolean;
  oss?: boolean;
  datevBuKey?: string;
}

export interface ChartTemplate {
  /** e.g. `DE-SKR03`, `FR-PCG`, `GENERIC-IFRS`. */
  key: string;
  country: string | null;
  name: string;
  description: string;
  /** General-ledger account number length (DATEV Sachkontenlänge); informative for other countries. */
  accountLength: number;
  accounts: ChartTemplateAccount[];
  taxCodes: ChartTemplateTaxCode[];
  /** Licence / source note shown in the UI. */
  source: string;
}

export interface StatementLayoutLine {
  /** Position code; account `statementPosition` values reference leaf codes. */
  code: string;
  label: string;
  /** Child lines (groups); leaf lines collect accounts. */
  children?: StatementLayoutLine[];
  /**
   * For P&L / cash-basis layouts: +1 for income lines, −1 for expense lines (sign applied to credit − debit).
   * Balance sheet: assets debit-positive, equity & liabilities credit-positive (handled by `side`).
   */
  sign?: 1 | -1;
}

export interface StatementLayout {
  key: string;
  name: string;
  kind: 'balance_sheet' | 'profit_and_loss' | 'cash_basis';
  /** Balance sheet only. */
  assets?: StatementLayoutLine[];
  equityAndLiabilities?: StatementLayoutLine[];
  /** P&L / cash basis. */
  lines?: StatementLayoutLine[];
  /** Position code receiving the period result (balance sheet equity). */
  resultPosition?: string;
}

export interface VatReturnBox {
  box: string;
  label: string;
  /** `base` and `tax` boxes sum tax code postings; `computed` boxes evaluate `formula`. */
  kind: 'base' | 'tax' | 'computed' | 'manual';
  /** Computed: `+81t +86t -66` style expression over other boxes (`t` suffix not used; plain box ids). */
  formula?: string;
  /** Round down to whole currency units (DE base boxes are in full euros). */
  roundDown?: boolean;
}

export interface VatReturnDefinition {
  /** e.g. `DE-USTVA`, `DE-ZM`, `EU-OSS`, `DE-UST-ANNUAL`, `AT-UVA`, `FR-CA3`, `UK-VAT100`. */
  key: string;
  name: string;
  kind: 'periodic' | 'annual' | 'ec_sales_list' | 'oss';
  periods: Array<'month' | 'quarter' | 'year'>;
  boxes: VatReturnBox[];
  /** Box holding the payable / refundable amount. */
  resultBox?: string;
  /** Filing channel shown to the user (manual filing). */
  filingChannel: string;
  filingUrl?: string;
  /** Due date rule shown in the UI, e.g. `10th day after period end`. */
  dueRule: string;
}

export type AccountingExportKind =
  | 'datev'
  | 'gdpdu'
  | 'fec'
  | 'saft'
  | 'journal_csv'
  | 'trial_balance_csv'
  | 'xaf'
  | 'sie';

export interface ProfilePrerequisite {
  /** Env var name. */
  env: string;
  label: string;
  /** Features that need it (VAT return keys, export kinds). */
  requiredFor: string[];
}

export interface AccountingCountryProfile {
  country: string;
  name: string;
  /** Default template key; admins may choose any template or build their own chart. */
  defaultTemplate: string;
  templates: string[];
  vatReturns: VatReturnDefinition[];
  balanceSheet: StatementLayout;
  profitAndLoss: StatementLayout;
  cashBasis?: StatementLayout;
  exports: AccountingExportKind[];
  prerequisites: ProfilePrerequisite[];
  /** Years to keep books / vouchers. */
  retention: { booksYears: number; vouchersYears: number };
  /** Default e-invoice format for this issuer country. */
  defaultEinvoiceFormat: string;
  /** Statutory requirement Decabill does not implement (real-time e-invoicing, certified software …). */
  complianceNotice?: string;
  /** Whether the chart is legally mandatory (affects template locking hints only). */
  mandatoryChart: boolean;
}
