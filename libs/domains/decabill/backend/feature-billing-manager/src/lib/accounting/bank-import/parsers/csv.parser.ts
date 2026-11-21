import {
  BankStatementParseError,
  DEFAULT_BANK_PARSE_LIMITS,
  type BankParseLimits,
  type CsvColumnMapping,
  type ParsedBalance,
  type ParsedStatement,
  type ParsedStatementFile,
  type ParsedTransaction,
  type ParsedTransactionDetail,
} from '../bank-import.types';
import {
  negateDecimal,
  normalizeBic,
  normalizeCurrency,
  normalizeDecimal,
  normalizeIban,
  parseDatePattern,
  sumDecimals,
} from '../bank-parse.utils';

import { ParseBudget, compactObject, fillPeriodFromTransactions, finalizeDetail, rawText } from './parser-common';

/**
 * Generic CSV bank / payment processor export, driven by a `CsvColumnMapping` (built-in presets in
 * `csv-presets.ts` or admin-defined mappings).
 *
 * - RFC 4180 tokenizer: quoted fields, doubled quotes, embedded newlines, CRLF/LF/CR; configurable delimiter or
 *   `auto` sniffing among `;` `,` tab `|` on the first lines after `skipLines`.
 * - Header names match case-insensitively after trimming whitespace, a BOM and surrounding quotes; columns can also
 *   be addressed by 0-based index.
 * - Amount from `amount`, or `credit − debit` (both taken as unsigned), optionally signed by a `sign` column
 *   matched against `debitIndicators`; `invertSign` flips the result.
 * - Rows whose `status` matches `pendingIndicators` become `pending`. Empty rows are skipped; unparsable amounts or
 *   dates raise `BankStatementParseError` with a `line N` locator.
 * - CSV files carry no account: one statement with `account: {}` is returned (the caller assigns the account).
 *   A `balance` column provides the closing balance (balance of the latest row, honouring descending exports).
 */

const SNIFF_CANDIDATES = [';', ',', '\t', '|'] as const;
const DEFAULT_DEBIT_INDICATORS = ['d', 's', 'dr', 'debit', 'soll', '-'];

export interface CsvRow {
  fields: string[];
  /** 1-based physical line where the row starts. */
  line: number;
}

/** RFC 4180 tokenizer. `lineOffset` is added to the reported line numbers (for skipped leading lines). */
export function tokenizeCsv(text: string, delimiter: string, maxFieldLength = 100_000, lineOffset = 0): CsvRow[] {
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let value = '';
  let inQuotes = false;
  let line = 1 + lineOffset;
  let rowLine = line;
  const pushField = (): void => {
    if (value.length > maxFieldLength) {
      throw new BankStatementParseError('CSV field exceeds the maximum length', `line ${rowLine}`);
    }

    fields.push(value);
    value = '';
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) {
          line += 1;
        }

        value += ch;

        if (value.length > maxFieldLength) {
          throw new BankStatementParseError('CSV field exceeds the maximum length', `line ${rowLine}`);
        }
      }

      continue;
    }

    if (ch === '"' && value.trim() === '') {
      inQuotes = true;
      value = '';
      continue;
    }

    if (ch === delimiter) {
      pushField();
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i += 1;
      }

      pushField();
      rows.push({ fields, line: rowLine });
      fields = [];
      line += 1;
      rowLine = line;
      continue;
    }

    value += ch;

    if (value.length > maxFieldLength) {
      throw new BankStatementParseError('CSV field exceeds the maximum length', `line ${rowLine}`);
    }
  }

  if (inQuotes) {
    throw new BankStatementParseError('Unterminated quoted CSV field', `line ${rowLine}`);
  }

  if (value !== '' || fields.length > 0) {
    pushField();
    rows.push({ fields, line: rowLine });
  }

  return rows;
}

/** Picks the delimiter that occurs (outside quotes) most consistently across the first non-empty lines. */
export function sniffDelimiter(text: string): ';' | ',' | '\t' | '|' {
  const sample: string[] = [];
  let start = 0;

  while (sample.length < 10 && start < text.length) {
    let end = text.indexOf('\n', start);

    if (end === -1) {
      end = text.length;
    }

    const line = text.slice(start, end).replace(/\r$/, '');

    if (line.trim() !== '') {
      sample.push(line);
    }

    start = end + 1;
  }

  let best: ';' | ',' | '\t' | '|' = ',';
  let bestScore = -1;
  let bestCount = 0;

  for (const candidate of SNIFF_CANDIDATES) {
    const counts = sample.map((line) => countOutsideQuotes(line, candidate));

    if (counts.length === 0 || counts[0] === 0) {
      continue;
    }

    const consistent = counts.filter((count) => count === counts[0]).length;

    if (consistent > bestScore || (consistent === bestScore && counts[0] > bestCount)) {
      best = candidate;
      bestScore = consistent;
      bestCount = counts[0];
    }
  }

  return best;
}

function countOutsideQuotes(line: string, char: string): number {
  let count = 0;
  let inQuotes = false;

  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === char && !inQuotes) {
      count += 1;
    }
  }

  return count;
}

function normalizeHeader(value: string): string {
  let header = value.trim();

  if (header.charCodeAt(0) === 0xfeff) {
    header = header.slice(1).trim();
  }

  while (header.length >= 1 && (header.startsWith('"') || header.startsWith("'"))) {
    header = header.slice(1);
  }

  while (header.length >= 1 && (header.endsWith('"') || header.endsWith("'"))) {
    header = header.slice(0, -1);
  }

  return header.trim().toLowerCase();
}

function skipPhysicalLines(text: string, count: number): string {
  let index = 0;

  for (let i = 0; i < count; i += 1) {
    const next = text.indexOf('\n', index);

    if (next === -1) {
      return '';
    }

    index = next + 1;
  }

  return text.slice(index);
}

type ColumnKey = keyof CsvColumnMapping['columns'];

export function parseCsv(
  text: string,
  mapping: CsvColumnMapping,
  limits: BankParseLimits = DEFAULT_BANK_PARSE_LIMITS,
): ParsedStatementFile {
  const warnings: string[] = [];
  const budget = new ParseBudget(limits);
  const skip = mapping.skipLines ?? 0;
  const body = skipPhysicalLines(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, skip);
  const delimiter = mapping.delimiter === 'auto' ? sniffDelimiter(body) : mapping.delimiter;
  const rows = tokenizeCsv(body, delimiter, limits.maxLineLength, skip).filter((row) =>
    row.fields.some((cell) => cell.trim() !== ''),
  );

  if (rows.length === 0) {
    throw new BankStatementParseError('CSV file has no rows');
  }

  const header = mapping.hasHeader ? rows.shift()?.fields.map(normalizeHeader) : undefined;
  const missing: string[] = [];
  const resolve = (key: ColumnKey, ref: string | number | undefined, required: boolean): number | undefined => {
    if (ref === undefined || ref === '') {
      return undefined;
    }

    if (typeof ref === 'number') {
      return ref;
    }

    if (!header) {
      if (/^\d+$/.test(ref.trim())) {
        return Number(ref.trim());
      }

      throw new BankStatementParseError(`Column "${ref}" (${key}) needs a header row`);
    }

    const index = header.indexOf(normalizeHeader(ref));

    if (index === -1) {
      if (required) {
        throw new BankStatementParseError(`Column "${ref}" (${key}) not found in the CSV header`);
      }

      missing.push(ref);

      return undefined;
    }

    return index;
  };
  const cols = mapping.columns;
  const idx = {
    bookingDate: resolve('bookingDate', cols.bookingDate, true),
    valueDate: resolve('valueDate', cols.valueDate, false),
    amount: resolve('amount', cols.amount, cols.debit === undefined && cols.credit === undefined),
    debit: resolve('debit', cols.debit, false),
    credit: resolve('credit', cols.credit, false),
    sign: resolve('sign', cols.sign, false),
    currency: resolve('currency', cols.currency, false),
    counterpartyName: resolve('counterpartyName', cols.counterpartyName, false),
    counterpartyIban: resolve('counterpartyIban', cols.counterpartyIban, false),
    counterpartyBic: resolve('counterpartyBic', cols.counterpartyBic, false),
    endToEndId: resolve('endToEndId', cols.endToEndId, false),
    mandateId: resolve('mandateId', cols.mandateId, false),
    creditorId: resolve('creditorId', cols.creditorId, false),
    bankReference: resolve('bankReference', cols.bankReference, false),
    bookingText: resolve('bookingText', cols.bookingText, false),
    balance: resolve('balance', cols.balance, false),
    status: resolve('status', cols.status, false),
    fee: resolve('fee', cols.fee, false),
    gross: resolve('gross', cols.gross, false),
    payoutId: resolve('payoutId', cols.payoutId, false),
    merchantReference: resolve('merchantReference', cols.merchantReference, false),
    category: resolve('category', cols.category, false),
  };
  const remittanceRefs =
    cols.remittance === undefined ? [] : Array.isArray(cols.remittance) ? cols.remittance : [cols.remittance];
  const remittanceIdx = remittanceRefs
    .map((ref) => resolve('remittance', ref, false))
    .filter((index): index is number => index !== undefined);

  if (idx.amount === undefined && idx.debit === undefined && idx.credit === undefined) {
    throw new BankStatementParseError('CSV mapping needs an amount column or debit/credit columns');
  }

  if (missing.length > 0) {
    warnings.push(`Optional CSV columns not found: ${missing.join(', ')}`);
  }

  budget.addStatement();

  const debitIndicators = (cols.debitIndicators ?? DEFAULT_DEBIT_INDICATORS).map((v) => v.trim().toLowerCase());
  const pendingIndicators = (cols.pendingIndicators ?? []).map((v) => v.trim().toLowerCase());
  const defaultCurrency = normalizeCurrency(mapping.defaultCurrency) ?? '';
  const transactions: ParsedTransaction[] = [];
  const balances: Array<ParsedBalance | undefined> = [];

  for (const row of rows) {
    const locator = `line ${row.line}`;
    const cell = (index: number | undefined): string => (index === undefined ? '' : (row.fields[index] ?? '').trim());
    const amountOf = (raw: string): string => parseCsvAmount(raw, mapping, locator);

    budget.addTransaction(locator);

    let amount: string;

    if (idx.amount !== undefined && cell(idx.amount) !== '') {
      amount = amountOf(cell(idx.amount));
    } else if (cell(idx.credit) !== '' || cell(idx.debit) !== '') {
      const credit = cell(idx.credit) !== '' ? amountOf(cell(idx.credit)).replace(/^-/, '') : '0';
      const debit = cell(idx.debit) !== '' ? amountOf(cell(idx.debit)).replace(/^-/, '') : '0';

      amount = sumDecimals([credit, negateDecimal(debit)]);
    } else {
      throw new BankStatementParseError('Row has no amount', locator);
    }

    if (idx.sign !== undefined) {
      const unsigned = amount.replace(/^-/, '');

      amount = debitIndicators.includes(cell(idx.sign).toLowerCase()) ? negateDecimal(unsigned) : unsigned;
    }

    if (mapping.invertSign) {
      amount = negateDecimal(amount);
    }

    const bookingRaw = cell(idx.bookingDate);

    if (bookingRaw === '') {
      throw new BankStatementParseError('Row has no booking date', locator);
    }

    const bookingDate = parseDatePattern(bookingRaw, mapping.dateFormat, locator);
    const valueRaw = cell(idx.valueDate);
    const currency = normalizeCurrency(cell(idx.currency)) ?? defaultCurrency;
    const remittance = remittanceIdx
      .map((index) => cell(index))
      .filter((value) => value !== '')
      .join(' ');
    const ibanCell = cell(idx.counterpartyIban);
    const iban = normalizeIban(ibanCell);
    const endToEndId = cell(idx.endToEndId);
    const detail: ParsedTransactionDetail = {
      remittance,
      endToEndId: endToEndId.toUpperCase() === 'NOTPROVIDED' ? undefined : endToEndId,
      mandateId: cell(idx.mandateId),
      creditorId: cell(idx.creditorId),
      counterparty: {
        name: cell(idx.counterpartyName),
        iban,
        accountNumber: iban ? undefined : ibanCell,
        bic: normalizeBic(cell(idx.counterpartyBic)),
      },
    };

    if (mapping.processorProvider) {
      detail.processor = compactObject({
        provider: mapping.processorProvider,
        payoutId: cell(idx.payoutId),
        gross: cell(idx.gross) !== '' ? amountOf(cell(idx.gross)) : undefined,
        fee: cell(idx.fee) !== '' ? amountOf(cell(idx.fee)) : undefined,
        net: amount,
        merchantReference: cell(idx.merchantReference),
        category: cell(idx.category),
      });
    }

    const status = cell(idx.status).toLowerCase();
    const transaction: ParsedTransaction = {
      status: status !== '' && pendingIndicators.includes(status) ? 'pending' : 'booked',
      bookingDate,
      valueDate: valueRaw !== '' ? parseDatePattern(valueRaw, mapping.dateFormat, locator) : undefined,
      amount,
      currency,
      isReversal: false,
      bookingText: cell(idx.bookingText) || undefined,
      bankReference: cell(idx.bankReference) || undefined,
      isBatch: false,
      details: [finalizeDetail(detail)],
      locator,
      raw: rawText([row.fields.join(delimiter)]),
    };

    transactions.push(transaction);

    const balanceRaw = cell(idx.balance);

    balances.push(balanceRaw !== '' ? { amount: amountOf(balanceRaw), currency, date: bookingDate } : undefined);
  }

  const currencies = new Set(transactions.map((tx) => tx.currency).filter((c) => c !== ''));
  const statement: ParsedStatement = {
    kind: 'csv',
    account: {},
    currency: currencies.size === 1 ? [...currencies][0] : defaultCurrency || undefined,
    closingBalance: pickClosingBalance(transactions, balances),
    transactions,
  };

  if (currencies.size > 1) {
    warnings.push(`CSV contains several currencies (${[...currencies].join(', ')})`);
  }

  fillPeriodFromTransactions(statement);

  return { format: 'csv', statements: [statement], warnings };
}

function pickClosingBalance(
  transactions: ParsedTransaction[],
  balances: Array<ParsedBalance | undefined>,
): ParsedBalance | undefined {
  if (transactions.length === 0) {
    return undefined;
  }

  const descending = transactions[0].bookingDate > transactions[transactions.length - 1].bookingDate;
  const ordered = descending ? balances : [...balances].reverse();

  return ordered.find((balance) => balance !== undefined);
}

/** Parses a CSV amount with the mapping's separators; currency symbols and codes are stripped. */
export function parseCsvAmount(
  raw: string,
  mapping: Pick<CsvColumnMapping, 'decimalSeparator' | 'thousandsSeparator'>,
  locator?: string,
): string {
  const cleaned = raw.replace(/[^\d.,\-+()−' \u00a0]/g, '').trim();

  try {
    return normalizeDecimal(cleaned, mapping.decimalSeparator, mapping.thousandsSeparator || undefined);
  } catch {
    throw new BankStatementParseError(`Invalid amount "${raw}"`, locator);
  }
}
