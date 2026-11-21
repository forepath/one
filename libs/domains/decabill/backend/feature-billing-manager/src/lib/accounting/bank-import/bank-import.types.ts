/**
 * Normalized model every bank/processor statement parser maps into.
 *
 * Amounts are decimal strings (`-12.50`, `1000.00`), never floats: parsers keep the precision of the source and
 * the import service converts them to the ledger's decimal columns. Positive = money in (credit to the account
 * holder), negative = money out, after reversal handling.
 */

export const BANK_STATEMENT_FORMATS = [
  'camt.052',
  'camt.053',
  'camt.054',
  'mt940',
  'mt942',
  'coda',
  'norma43',
  'cfonb120',
  'cbi-rh',
  'bai2',
  'ofx',
  'qif',
  'csv',
] as const;

export type BankStatementFormat = (typeof BANK_STATEMENT_FORMATS)[number];

export type BankStatementKind = 'statement' | 'intraday' | 'notification' | 'processor_report' | 'csv';

export type BankTransactionStatus = 'booked' | 'pending' | 'info';

export type StructuredReferenceType = 'SCOR' | 'QRR' | 'BBA' | 'KID' | 'OTHER';

export interface ParsedBalance {
  /** Signed decimal string. */
  amount: string;
  currency: string;
  /** ISO date `YYYY-MM-DD`. */
  date: string;
}

export interface ParsedAccountIdentifier {
  iban?: string;
  /** National account number (BBAN, CCC, RIB, BLZ/Konto …) when no IBAN is present. */
  accountNumber?: string;
  bankCode?: string;
  bic?: string;
}

export interface ParsedCounterparty {
  name?: string;
  iban?: string;
  accountNumber?: string;
  bic?: string;
  ultimateName?: string;
}

export interface ParsedStructuredReference {
  type: StructuredReferenceType;
  reference: string;
  issuer?: string;
}

export interface ParsedTransactionDetail {
  /** Signed decimal string; only set when it differs from the entry (batch breakdowns). */
  amount?: string;
  currency?: string;
  originalAmount?: string;
  originalCurrency?: string;
  exchangeRate?: string;
  endToEndId?: string;
  instructionId?: string;
  paymentInformationId?: string;
  messageId?: string;
  uetr?: string;
  mandateId?: string;
  creditorId?: string;
  counterparty?: ParsedCounterparty;
  /** Unstructured remittance, joined and whitespace-normalized. */
  remittance?: string;
  structuredReferences?: ParsedStructuredReference[];
  /** ISO 20022 return reason (AC04, MD06 …) for returned payments. */
  returnReason?: string;
  /** Processor reports (Stripe, PayPal, Mollie, Adyen). */
  processor?: {
    provider: string;
    payoutId?: string;
    chargeId?: string;
    gross?: string;
    fee?: string;
    net?: string;
    merchantReference?: string;
    category?: string;
  };
}

export interface ParsedTransaction {
  status: BankTransactionStatus;
  /** ISO date `YYYY-MM-DD`. */
  bookingDate: string;
  valueDate?: string;
  /** Signed decimal string (+ money in, − money out). */
  amount: string;
  currency: string;
  isReversal: boolean;
  bankTransactionCode?: {
    domain?: string;
    family?: string;
    subFamily?: string;
    proprietary?: string;
    /** German Geschäftsvorfallcode (DK), CODA/N43/CFONB/BAI type code … */
    national?: string;
  };
  bookingText?: string;
  /** Bank-unique reference (AcctSvcrRef, :61: bank ref, FITID, processor id). Used for dedupe when present. */
  bankReference?: string;
  entryReference?: string;
  isBatch: boolean;
  batchCount?: number;
  details: ParsedTransactionDetail[];
  /** Position in the source for audit (line number, record index, xpath-like path). */
  locator: string;
  /** Original source text of the entry (e.g. MT940 :61:+:86:), truncated to 4000 chars. */
  raw?: string;
}

export interface ParsedStatement {
  kind: BankStatementKind;
  account: ParsedAccountIdentifier;
  currency?: string;
  /** camt Stmt/Id, MT940 :20:, CODA sequence … */
  statementId?: string;
  sequenceNumber?: string;
  /** ISO dates. */
  periodFrom?: string;
  periodTo?: string;
  openingBalance?: ParsedBalance;
  closingBalance?: ParsedBalance;
  availableBalance?: ParsedBalance;
  transactions: ParsedTransaction[];
}

export interface ParsedStatementFile {
  format: BankStatementFormat;
  /** Format version where meaningful (camt `001.08`, CODA `2`, OFX `102`/`220`). */
  formatVersion?: string;
  /** Detected text encoding (`utf-8`, `windows-1252`, `iso-8859-1`, `cp850`). */
  encoding?: string;
  statements: ParsedStatement[];
  warnings: string[];
}

/** CSV column-mapping definition (built-in presets and admin-saved custom mappings share this shape). */
export interface CsvColumnMapping {
  /** Field delimiter; `auto` sniffs `;`, `,`, tab and `|`. */
  delimiter: ';' | ',' | '\t' | '|' | 'auto';
  /** Decimal separator of amounts. */
  decimalSeparator: '.' | ',';
  /** Thousands separator to strip, if any. */
  thousandsSeparator?: '.' | ',' | ' ' | "'" | '';
  /** Date pattern using `DD`, `MM`, `YY`, `YYYY` tokens and literal separators, e.g. `DD.MM.YYYY`. */
  dateFormat: string;
  /** Text encoding; `auto` detects BOM/UTF-8 and falls back to windows-1252. */
  encoding: 'auto' | 'utf-8' | 'windows-1252' | 'iso-8859-1';
  /** Number of leading lines to skip before the header row. */
  skipLines?: number;
  /** Column names (header text, case-insensitive, trimmed) or 0-based indexes when `hasHeader` is false. */
  hasHeader: boolean;
  columns: {
    bookingDate: string | number;
    valueDate?: string | number;
    /** Single signed amount column … */
    amount?: string | number;
    /** … or separate debit/credit columns (both unsigned). */
    debit?: string | number;
    credit?: string | number;
    /** Optional column holding a sign indicator; value matched against `debitIndicators`. */
    sign?: string | number;
    debitIndicators?: string[];
    currency?: string | number;
    counterpartyName?: string | number;
    counterpartyIban?: string | number;
    counterpartyBic?: string | number;
    remittance?: Array<string | number> | string | number;
    endToEndId?: string | number;
    mandateId?: string | number;
    creditorId?: string | number;
    bankReference?: string | number;
    bookingText?: string | number;
    balance?: string | number;
    /** Column whose value marks a row as pending (matched against `pendingIndicators`). */
    status?: string | number;
    pendingIndicators?: string[];
    fee?: string | number;
    gross?: string | number;
    payoutId?: string | number;
    merchantReference?: string | number;
    category?: string | number;
  };
  /** Currency used when there is no currency column. */
  defaultCurrency?: string;
  /** Flip the sign of amounts (some exports show outflows as positive). */
  invertSign?: boolean;
  /** Processor provider name to set on details (`stripe`, `paypal` …). */
  processorProvider?: string;
}

export class BankStatementParseError extends Error {
  constructor(
    message: string,
    readonly locator?: string,
  ) {
    super(locator ? `${message} (${locator})` : message);
    this.name = 'BankStatementParseError';
  }
}

/** Hard limits applied by every parser (defence against oversized or hostile input). */
export interface BankParseLimits {
  maxTransactions: number;
  maxStatements: number;
  maxLineLength: number;
}

export const DEFAULT_BANK_PARSE_LIMITS: BankParseLimits = {
  maxTransactions: 200_000,
  maxStatements: 10_000,
  maxLineLength: 100_000,
};
