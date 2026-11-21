import {
  BankStatementParseError,
  DEFAULT_BANK_PARSE_LIMITS,
  type BankParseLimits,
  type ParsedStatement,
  type ParsedStatementFile,
  type ParsedTransaction,
} from '../bank-import.types';
import { impliedDecimal, normalizeCurrency, splitLines, yymmddToIso } from '../bank-parse.utils';

import { ParseBudget, checkBalanceContinuity, finalizeDetail, rawText, signed } from './parser-common';

/**
 * BAI2 / BTRS cash management balance reporting.
 *
 * Records are comma-delimited and end with `/`; an `88` record continues the previous logical record (also in the
 * middle of a 16 record's fields). For 16 records the text field runs to the end of the logical record and may
 * contain commas; `88` continuations of the text are joined with a space.
 *
 *  01 file header: sender, receiver, creation date, time, file id, record length, block size, version (`2`)
 *  02 group header: receiver, originator, group status, as-of date YYMMDD, as-of time, currency, date modifier
 *  03 account: account number, currency, then repeating [type code, amount, item count, funds type (+ funds data)]
 *     balance type codes: 010 opening ledger, 015 closing ledger, 040 opening available, 045 closing available
 *  16 transaction: type code, amount, funds type (+ funds data), bank reference, customer reference, text
 *  49 account trailer · 98 group trailer · 99 file trailer
 *
 * Funds type: `0`/`1`/`2`/`Z`/empty → no extra fields; `S` → 3 amounts (immediate, one-day, two-plus-day);
 * `V` → value date YYMMDD + time; `D` → count n followed by n pairs (days, amount).
 *
 * Amounts have implied decimals per currency (2; 0 for JPY/KRW/…; 3 for BHD/KWD/…).
 * Transaction sign by type code: 100–399 credit, 400–699 debit, 900–959 customized credit, 960–999 customized
 * debit. 700–799 (loan detail) and others are kept as `info` entries with a warning.
 */

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'CLP', 'ISK', 'VND', 'XOF', 'XAF', 'HUF']);
const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'KWD', 'OMR', 'TND', 'JOD', 'IQD', 'LYD']);

export function bai2Decimals(currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency)) {
    return 0;
  }

  return THREE_DECIMAL_CURRENCIES.has(currency) ? 3 : 2;
}

interface LogicalRecord {
  code: string;
  /** Physical record contents, first one including the record code. */
  segments: string[];
  line: number;
  rawLines: string[];
}

/** Reads comma-separated fields across the physical segments of a logical record. */
class FieldReader {
  private segment = 0;
  private position = 0;

  constructor(private readonly segments: string[]) {}

  next(): string | undefined {
    while (this.segment < this.segments.length) {
      const current = this.segments[this.segment];
      const isLast = this.segment === this.segments.length - 1;

      if (this.position > current.length || (this.position === current.length && !isLast)) {
        this.segment += 1;
        this.position = 0;
        continue;
      }

      const comma = current.indexOf(',', this.position);

      if (comma === -1) {
        const value = current.slice(this.position);

        this.position = current.length + 1;

        return value;
      }

      const value = current.slice(this.position, comma);

      this.position = comma + 1;

      return value;
    }

    return undefined;
  }

  /** Remaining text of the current segment plus all following segments, joined with a space. */
  rest(): string {
    const parts: string[] = [];

    if (this.segment < this.segments.length && this.position <= this.segments[this.segment].length) {
      parts.push(this.segments[this.segment].slice(this.position));
    }

    for (let i = this.segment + 1; i < this.segments.length; i += 1) {
      parts.push(this.segments[i]);
    }

    this.segment = this.segments.length;

    return parts.join(' ');
  }
}

function stripTerminator(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function readLogicalRecords(text: string, maxLineLength: number): LogicalRecord[] {
  const records: LogicalRecord[] = [];
  const lines = splitLines(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, maxLineLength);

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();

    if (line.length === 0) {
      return;
    }

    const comma = line.indexOf(',');
    const code = (comma === -1 ? stripTerminator(line) : line.slice(0, comma)).trim();

    if (code === '88') {
      const previous = records[records.length - 1];

      if (!previous) {
        throw new BankStatementParseError('Continuation record without a preceding record', `line ${idx + 1}`);
      }

      previous.segments.push(comma === -1 ? '' : line.slice(comma + 1));
      previous.rawLines.push(line);

      return;
    }

    records.push({ code, segments: [line], line: idx + 1, rawLines: [line] });
  });

  return records;
}

/** Fields of a non-16 record: segments joined with `,`, terminators removed. */
function simpleFields(record: LogicalRecord): string[] {
  return record.segments
    .map((segment) => stripTerminator(segment.trim()))
    .join(',')
    .split(',')
    .map((value) => value.trim());
}

function readFundsDetails(read: () => string | undefined, fundsType: string, locator: string): { valueDate?: string } {
  switch (fundsType.toUpperCase()) {
    case 'S':
      read();
      read();
      read();

      return {};

    case 'V': {
      const date = (read() ?? '').trim();

      read();

      return { valueDate: date ? yymmddToIso(date, locator) : undefined };
    }

    case 'D': {
      const count = Number((read() ?? '0').trim() || '0');

      if (!Number.isInteger(count) || count < 0 || count > 100) {
        throw new BankStatementParseError(`Invalid funds distribution count "${count}"`, locator);
      }

      for (let i = 0; i < count; i += 1) {
        read();
        read();
      }

      return {};
    }

    default:
      return {};
  }
}

function amountOf(raw: string | undefined, currency: string, locator: string): string {
  const value = (raw ?? '').trim();

  if (value === '') {
    return impliedDecimal('0', bai2Decimals(currency));
  }

  const negative = value.startsWith('-');
  const digits = value.replace(/^[+-]/, '');

  if (!/^\d+$/.test(digits)) {
    throw new BankStatementParseError(`Invalid amount "${value}"`, locator);
  }

  return signed(impliedDecimal(digits, bai2Decimals(currency)), negative);
}

function typeSign(typeCode: number): 'credit' | 'debit' | undefined {
  if ((typeCode >= 100 && typeCode <= 399) || (typeCode >= 900 && typeCode <= 959)) {
    return 'credit';
  }

  if ((typeCode >= 400 && typeCode <= 699) || (typeCode >= 960 && typeCode <= 999)) {
    return 'debit';
  }

  return undefined;
}

interface Bai2Group {
  asOfDate?: string;
  currency?: string;
}

export function parseBai2(text: string, limits: BankParseLimits = DEFAULT_BANK_PARSE_LIMITS): ParsedStatementFile {
  const records = readLogicalRecords(text, limits.maxLineLength);
  const budget = new ParseBudget(limits);
  const warnings: string[] = [];
  const statements: ParsedStatement[] = [];
  let formatVersion: string | undefined;
  let group: Bai2Group = {};
  let statement: ParsedStatement | undefined;
  let accountLine = 0;

  if (records.length === 0 || records[0].code !== '01') {
    throw new BankStatementParseError('Not a BAI2 file (expected record 01)', 'line 1');
  }

  const closeAccount = (): void => {
    if (!statement) {
      return;
    }

    checkBalanceContinuity(statement, `BAI2 account at line ${accountLine}`, warnings);
    statements.push(statement);
    statement = undefined;
  };

  for (const record of records) {
    const locator = `line ${record.line}`;

    switch (record.code) {
      case '01': {
        const fields = simpleFields(record);

        formatVersion = formatVersion ?? (fields[8] || undefined);
        break;
      }

      case '02': {
        closeAccount();

        const fields = simpleFields(record);

        group = {
          asOfDate: fields[4] ? yymmddToIso(fields[4], locator) : undefined,
          currency: normalizeCurrency(fields[6]),
        };
        break;
      }

      case '03': {
        closeAccount();
        budget.addStatement(locator);
        accountLine = record.line;
        statement = parseAccount(record, group, locator);
        break;
      }

      case '16': {
        if (!statement) {
          throw new BankStatementParseError('Transaction outside of an account', locator);
        }

        budget.addTransaction(locator);
        statement.transactions.push(parseTransaction(record, statement, group, warnings, locator));
        break;
      }

      case '49':
      case '98':
      case '99':
        closeAccount();
        break;

      default:
        warnings.push(`Unknown BAI2 record type "${record.code}" ignored (${locator})`);
    }
  }

  closeAccount();

  return { format: 'bai2', formatVersion, statements, warnings };
}

function parseAccount(record: LogicalRecord, group: Bai2Group, locator: string): ParsedStatement {
  const fields = simpleFields(record);
  const currency = normalizeCurrency(fields[2], group.currency) ?? 'USD';
  const date = group.asOfDate;
  const statement: ParsedStatement = {
    kind: 'statement',
    account: fields[1] ? { accountNumber: fields[1] } : {},
    currency,
    periodFrom: date,
    periodTo: date,
    transactions: [],
  };
  let index = 3;
  const read = (): string | undefined => {
    const value = index < fields.length ? fields[index] : undefined;

    index += 1;

    return value;
  };

  while (index < fields.length) {
    const typeCode = (read() ?? '').trim();
    const amountRaw = read();

    read(); // item count

    const fundsType = (read() ?? '').trim();

    readFundsDetails(read, fundsType, locator);

    if (!typeCode || (amountRaw ?? '').trim() === '' || !date) {
      continue;
    }

    const balance = { amount: amountOf(amountRaw, currency, locator), currency, date };

    if (typeCode === '010') {
      statement.openingBalance = balance;
    } else if (typeCode === '015') {
      statement.closingBalance = balance;
    } else if (typeCode === '045' || (typeCode === '040' && !statement.availableBalance)) {
      statement.availableBalance = balance;
    }
  }

  return statement;
}

function parseTransaction(
  record: LogicalRecord,
  statement: ParsedStatement,
  group: Bai2Group,
  warnings: string[],
  locator: string,
): ParsedTransaction {
  const segments = record.segments.map((segment) => stripTerminator(segment.trimEnd()));
  const reader = new FieldReader(segments);
  const read = (): string | undefined => reader.next();

  read(); // record code

  const typeCodeRaw = (read() ?? '').trim();
  const currency = statement.currency ?? 'USD';
  const amount = amountOf(read(), currency, locator);
  const fundsType = (read() ?? '').trim();
  const { valueDate } = readFundsDetails(read, fundsType, locator);
  const bankReference = (read() ?? '').trim();
  const customerReference = (read() ?? '').trim();
  const text = reader.rest().trim();
  const typeCode = Number(typeCodeRaw);
  const direction = /^\d{3}$/.test(typeCodeRaw) ? typeSign(typeCode) : undefined;
  const bookingDate = group.asOfDate;

  if (!bookingDate) {
    throw new BankStatementParseError('Group header has no as-of date', locator);
  }

  if (!direction) {
    warnings.push(`Type code "${typeCodeRaw}" has no credit/debit direction; kept as info entry (${locator})`);
  }

  return {
    status: direction ? 'booked' : 'info',
    bookingDate,
    valueDate,
    amount: signed(amount.replace(/^-/, ''), direction === 'debit'),
    currency,
    isReversal: false,
    bankTransactionCode: { national: typeCodeRaw },
    bankReference: bankReference && !/^0+$/.test(bankReference) ? bankReference : undefined,
    entryReference: customerReference && !/^0+$/.test(customerReference) ? customerReference : undefined,
    isBatch: false,
    details: [finalizeDetail({ remittance: text })],
    locator,
    raw: rawText(record.rawLines),
  };
}
