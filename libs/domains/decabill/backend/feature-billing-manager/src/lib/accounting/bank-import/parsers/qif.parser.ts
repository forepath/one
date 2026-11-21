import {
  BankStatementParseError,
  DEFAULT_BANK_PARSE_LIMITS,
  type BankParseLimits,
  type ParsedStatement,
  type ParsedStatementFile,
  type ParsedTransaction,
} from '../bank-import.types';
import { expandYear, isoDate, splitLines } from '../bank-parse.utils';

import { ParseBudget, fillPeriodFromTransactions, finalizeDetail, parseLooseAmount, rawText } from './parser-common';

/**
 * Quicken Interchange Format. Sections start with `!Type:<name>`; records are lines prefixed with a field code and
 * end with `^`. Bank-like sections (`Bank`, `Cash`, `CCard`, `Oth A`, `Oth L`) are imported, one statement per
 * section; `!Account` blocks name the account of the following section; other sections (`Invst`, `Cat`, `Class`,
 * `Memorized` …) and `!Option`/`!Clear` lines are skipped.
 *
 * Fields: D date · T/U amount · P payee → counterparty name · M memo → remittance · N number → bankReference
 * L category → bookingText · C cleared status (ignored) · A address, S/E/$ splits (ignored). A leading
 * `Opening Balance` pseudo transaction (`L[Account]`) becomes the opening balance.
 *
 * QIF carries neither account identifiers nor currency: `account` stays empty and `currency` is `options.currency`
 * or an empty string — the caller assigns both.
 */

export interface QifParseOptions {
  /** Day/month order of ambiguous dates; `auto` (default) scans all dates for a component > 12. */
  dateFormat?: 'DMY' | 'MDY' | 'auto';
  currency?: string;
  limits?: BankParseLimits;
}

const BANK_TYPES = new Set(['BANK', 'CASH', 'CCARD', 'OTH A', 'OTH L']);
/** `MM/DD'YY`, `MM/DD/YYYY`, `DD.MM.YYYY`, `DD/MM/YYYY`, `D-M-YY` … (Quicken may pad with spaces: ` 1/ 5'04`). */
const DMY_MDY_DATE = /^(\d{1,2})([/.-])(\d{1,2})(['/.-])(\d{2}|\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

interface QifRecord {
  fields: Array<{ code: string; value: string }>;
  line: number;
  lines: string[];
}

interface QifSection {
  type: string;
  accountName?: string;
  line: number;
  records: QifRecord[];
}

function splitSections(lines: string[], warnings: string[]): QifSection[] {
  const sections: QifSection[] = [];
  let section: QifSection | undefined;
  let current: QifRecord | undefined;
  let inAccountBlock = false;
  let pendingAccountName: string | undefined;
  let accountBlockName: string | undefined;

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    const lineNo = idx + 1;

    if (line.length === 0) {
      return;
    }

    if (line.startsWith('!')) {
      const header = line.slice(1).trim();
      const upper = header.toUpperCase();

      current = undefined;

      if (upper === 'ACCOUNT') {
        inAccountBlock = true;
        accountBlockName = undefined;
      } else if (upper.startsWith('TYPE:')) {
        inAccountBlock = false;
        section = {
          type: header.slice(5).trim().toUpperCase(),
          accountName: pendingAccountName,
          line: lineNo,
          records: [],
        };
        pendingAccountName = undefined;
        sections.push(section);
      } else if (!upper.startsWith('OPTION') && !upper.startsWith('CLEAR')) {
        warnings.push(`Unknown QIF header "${header}" ignored (line ${lineNo})`);
      }

      return;
    }

    if (inAccountBlock) {
      if (line.startsWith('N')) {
        accountBlockName = line.slice(1).trim();
      } else if (line.startsWith('^')) {
        pendingAccountName = accountBlockName;
      }

      return;
    }

    if (!section) {
      warnings.push(`QIF data before the first !Type header ignored (line ${lineNo})`);

      return;
    }

    if (line.startsWith('^')) {
      current = undefined;

      return;
    }

    if (!current) {
      current = { fields: [], line: lineNo, lines: [] };
      section.records.push(current);
    }

    current.fields.push({ code: line[0].toUpperCase(), value: line.slice(1).trim() });
    current.lines.push(line);
  });

  return sections;
}

interface DateParts {
  a: number;
  b: number;
  year: number;
  separator: string;
  yearSeparator: string;
}

function dateParts(value: string): DateParts | { iso: string } | undefined {
  const compact = value.replace(/\s/g, '');
  const iso = ISO_DATE.exec(compact);

  if (iso) {
    return { iso: `${iso[1]}-${iso[2]}-${iso[3]}` };
  }

  const match = DMY_MDY_DATE.exec(compact);

  if (!match) {
    return undefined;
  }

  const yearRaw = match[5];
  let year = Number(yearRaw);

  if (yearRaw.length === 2) {
    // Quicken writes years ≥ 2000 as `'YY`; `/YY` follows the usual pivot.
    year = match[4] === "'" ? 2000 + year : expandYear(year);
  }

  return { a: Number(match[1]), b: Number(match[3]), year, separator: match[2], yearSeparator: match[4] };
}

function decideOrder(parts: DateParts[], warnings: string[]): 'DMY' | 'MDY' {
  if (parts.some((p) => p.a > 12)) {
    return 'DMY';
  }

  if (parts.some((p) => p.b > 12)) {
    return 'MDY';
  }

  if (parts.some((p) => p.yearSeparator === "'")) {
    return 'MDY';
  }

  if (parts.length > 0 && parts.every((p) => p.separator === '.')) {
    return 'DMY';
  }

  if (parts.length > 0) {
    warnings.push('QIF date order is ambiguous; assuming day/month/year');
  }

  return 'DMY';
}

export function parseQif(text: string, options: QifParseOptions = {}): ParsedStatementFile {
  const limits = options.limits ?? DEFAULT_BANK_PARSE_LIMITS;
  const budget = new ParseBudget(limits);
  const warnings: string[] = [];
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const sections = splitSections(splitLines(source, limits.maxLineLength), warnings);

  if (sections.length === 0) {
    throw new BankStatementParseError('Not a QIF file (no !Type header)');
  }

  const bankSections = sections.filter((section) => {
    if (BANK_TYPES.has(section.type)) {
      return true;
    }

    if (section.type === 'INVST') {
      warnings.push(`QIF investment section skipped (line ${section.line})`);
    }

    return false;
  });
  const allParts: DateParts[] = [];

  for (const section of bankSections) {
    for (const record of section.records) {
      const date = record.fields.find((f) => f.code === 'D');
      const parts = date ? dateParts(date.value) : undefined;

      if (parts && !('iso' in parts)) {
        allParts.push(parts);
      }
    }
  }

  const order =
    options.dateFormat && options.dateFormat !== 'auto' ? options.dateFormat : decideOrder(allParts, warnings);
  const statements: ParsedStatement[] = [];

  for (const section of bankSections) {
    const locator = `line ${section.line}`;

    budget.addStatement(locator);

    const statement: ParsedStatement = {
      kind: 'statement',
      account: {},
      currency: options.currency,
      statementId: section.accountName,
      transactions: [],
    };

    for (const record of section.records) {
      const transaction = parseRecord(record, order, options.currency ?? '', budget);

      if (!transaction) {
        continue;
      }

      // Quicken exports the starting balance as a pseudo transaction `POpening Balance` / `L[Account]`.
      if (
        transaction.details[0]?.counterparty?.name?.toLowerCase() === 'opening balance' &&
        transaction.bookingText?.startsWith('[') &&
        !statement.openingBalance &&
        statement.transactions.length === 0
      ) {
        statement.openingBalance = {
          amount: transaction.amount,
          currency: transaction.currency,
          date: transaction.bookingDate,
        };
        continue;
      }

      statement.transactions.push(transaction);
    }

    fillPeriodFromTransactions(statement);
    statements.push(statement);
  }

  return { format: 'qif', statements, warnings };
}

function parseRecord(
  record: QifRecord,
  order: 'DMY' | 'MDY',
  currency: string,
  budget: ParseBudget,
): ParsedTransaction | undefined {
  const locator = `line ${record.line}`;
  const get = (code: string): string | undefined => record.fields.find((f) => f.code === code)?.value || undefined;
  const dateRaw = get('D');
  const amountRaw = get('T') ?? get('U');

  if (!dateRaw && !amountRaw) {
    return undefined;
  }

  if (!dateRaw || !amountRaw) {
    throw new BankStatementParseError('QIF record needs a date (D) and an amount (T)', locator);
  }

  budget.addTransaction(locator);

  const parts = dateParts(dateRaw);

  if (!parts) {
    throw new BankStatementParseError(`Unrecognized QIF date "${dateRaw}"`, locator);
  }

  let bookingDate: string;

  if ('iso' in parts) {
    const [y, m, d] = parts.iso.split('-').map(Number);

    bookingDate = isoDate(y, m, d, locator);
  } else {
    const day = order === 'DMY' ? parts.a : parts.b;
    const month = order === 'DMY' ? parts.b : parts.a;

    bookingDate = isoDate(parts.year, month, day, locator);
  }

  return {
    status: 'booked',
    bookingDate,
    amount: parseLooseAmount(amountRaw, locator),
    currency,
    isReversal: false,
    bookingText: get('L'),
    bankReference: get('N'),
    isBatch: false,
    details: [finalizeDetail({ remittance: get('M'), counterparty: { name: get('P') } })],
    locator,
    raw: rawText(record.lines),
  };
}
