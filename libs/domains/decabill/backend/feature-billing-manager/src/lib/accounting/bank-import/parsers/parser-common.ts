import {
  BankStatementParseError,
  DEFAULT_BANK_PARSE_LIMITS,
  type BankParseLimits,
  type ParsedCounterparty,
  type ParsedStatement,
  type ParsedStructuredReference,
  type ParsedTransactionDetail,
} from '../bank-import.types';
import {
  cleanText,
  compareDecimals,
  extractStructuredReferences,
  negateDecimal,
  normalizeDecimal,
  sumDecimals,
  truncate,
} from '../bank-parse.utils';

/** Maximum length of `ParsedTransaction.raw` and of joined remittance text. */
export const RAW_MAX_LENGTH = 4000;

export interface FixedWidthRecord {
  /** Record text, right-padded with spaces to the record length. */
  text: string;
  /** 1-based record number within the file (used in `record N` locators). */
  index: number;
}

/**
 * Splits a fixed-width file into records. Tolerates CRLF/LF/CR separators, trimmed trailing spaces, a Ctrl-Z EOF
 * marker and files whose records are not newline-separated at all (a line longer than one record is cut into
 * chunks of `recordLength`).
 */
export function splitFixedWidthRecords(text: string, recordLength: number): FixedWidthRecord[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: FixedWidthRecord[] = [];

  for (const line of source.split(/\r\n|\n|\r/)) {
    const trimmed = line.split('\u001a').join('').trimEnd();

    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed.length <= recordLength) {
      records.push({ text: trimmed.padEnd(recordLength, ' '), index: records.length + 1 });
      continue;
    }

    for (let offset = 0; offset < trimmed.length; offset += recordLength) {
      const chunk = trimmed.slice(offset, offset + recordLength);

      if (chunk.trim().length > 0) {
        records.push({ text: chunk.padEnd(recordLength, ' '), index: records.length + 1 });
      }
    }
  }

  return records;
}

/** 1-based, inclusive column slice (`field(r, 3, 6)` = columns 3..6), matching the positions in format specs. */
export function field(record: string, from: number, to: number): string {
  return record.slice(from - 1, to);
}

/** Counts statements/transactions and throws once a limit of `DEFAULT_BANK_PARSE_LIMITS` is exceeded. */
export class ParseBudget {
  private statementCount = 0;
  private transactionCount = 0;

  constructor(private readonly limits: BankParseLimits = DEFAULT_BANK_PARSE_LIMITS) {}

  addStatement(locator?: string): void {
    this.statementCount += 1;

    if (this.statementCount > this.limits.maxStatements) {
      throw new BankStatementParseError(`File exceeds the limit of ${this.limits.maxStatements} statements`, locator);
    }
  }

  addTransaction(locator?: string): void {
    this.transactionCount += 1;

    if (this.transactionCount > this.limits.maxTransactions) {
      throw new BankStatementParseError(
        `File exceeds the limit of ${this.limits.maxTransactions} transactions`,
        locator,
      );
    }
  }
}

export function signed(amount: string, negative: boolean): string {
  return negative ? negateDecimal(amount) : amount;
}

/** Joins source records/lines for `ParsedTransaction.raw`. */
export function rawText(parts: string[]): string | undefined {
  return truncate(parts.map((part) => part.trimEnd()).join('\n'), RAW_MAX_LENGTH);
}

/** Drops `undefined` and empty-string properties (keeps parse output stable for comparisons and storage). */
export function compactObject<T extends object>(value: T): T {
  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && entry !== '') {
      result[key] = entry;
    }
  }

  return result as T;
}

/**
 * Cleans a detail: normalizes remittance and counterparty texts, merges structured references found in the
 * remittance (RF, Belgian OGM) with the ones the format carries explicitly, and drops empty fields.
 */
export function finalizeDetail(detail: ParsedTransactionDetail): ParsedTransactionDetail {
  const remittance = truncate(cleanText(detail.remittance), RAW_MAX_LENGTH);
  const references: ParsedStructuredReference[] = [...(detail.structuredReferences ?? [])];

  for (const found of extractStructuredReferences(remittance)) {
    if (!references.some((ref) => ref.type === found.type && ref.reference === found.reference)) {
      references.push(found);
    }
  }

  let counterparty: ParsedCounterparty | undefined;

  if (detail.counterparty) {
    counterparty = compactObject({
      name: cleanText(detail.counterparty.name),
      iban: detail.counterparty.iban,
      accountNumber: cleanText(detail.counterparty.accountNumber),
      bic: detail.counterparty.bic,
      ultimateName: cleanText(detail.counterparty.ultimateName),
    });

    if (Object.keys(counterparty).length === 0) {
      counterparty = undefined;
    }
  }

  return compactObject({
    ...detail,
    remittance,
    counterparty,
    structuredReferences: references.length > 0 ? references : undefined,
  });
}

/** Adds a warning when opening balance + Σ booked amounts ≠ closing balance. */
export function checkBalanceContinuity(statement: ParsedStatement, label: string, warnings: string[]): void {
  const { openingBalance, closingBalance } = statement;

  if (!openingBalance || !closingBalance) {
    return;
  }

  const movements = sumDecimals(statement.transactions.filter((tx) => tx.status === 'booked').map((tx) => tx.amount));
  const expected = sumDecimals([openingBalance.amount, movements]);

  if (compareDecimals(expected, closingBalance.amount) !== 0) {
    warnings.push(
      `${label}: opening balance ${openingBalance.amount} + movements ${movements} = ${expected} ` +
        `does not match closing balance ${closingBalance.amount}`,
    );
  }
}

/** Sets `periodFrom`/`periodTo` from the transactions when the format does not carry them. */
export function fillPeriodFromTransactions(statement: ParsedStatement): void {
  const dates = statement.transactions.map((tx) => tx.bookingDate).sort();

  if (dates.length === 0) {
    return;
  }

  statement.periodFrom = statement.periodFrom ?? dates[0];
  statement.periodTo = statement.periodTo ?? dates[dates.length - 1];
}

function countChar(value: string, char: string): number {
  return value.split(char).length - 1;
}

/**
 * Parses an amount whose decimal separator is not declared (OFX, QIF exports): when both `,` and `.` occur the
 * last one is the decimal separator; a single `,` followed by exactly three digits (`1,234`) is a thousands
 * separator; several occurrences of the same character are thousands separators.
 */
export function parseLooseAmount(raw: string, locator?: string): string {
  const value = raw.trim().replace(/[\s\u00a0']/g, '');
  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  let decimalSeparator: '.' | ',' = '.';
  let thousandsSeparator: string | undefined;

  if (lastComma >= 0 && lastDot >= 0) {
    decimalSeparator = lastComma > lastDot ? ',' : '.';
    thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
  } else if (lastComma >= 0) {
    const digitsAfter = value.length - lastComma - 1 - (/[)\-+]$/.test(value) ? 1 : 0);

    if (countChar(value, ',') > 1 || digitsAfter === 3) {
      thousandsSeparator = ',';
    } else {
      decimalSeparator = ',';
    }
  } else if (lastDot >= 0 && countChar(value, '.') > 1) {
    thousandsSeparator = '.';
    decimalSeparator = ',';
  }

  try {
    return normalizeDecimal(value, decimalSeparator, thousandsSeparator);
  } catch {
    throw new BankStatementParseError(`Invalid amount "${raw}"`, locator);
  }
}
