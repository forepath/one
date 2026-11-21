import {
  BankStatementParseError,
  DEFAULT_BANK_PARSE_LIMITS,
  type BankParseLimits,
  type ParsedAccountIdentifier,
  type ParsedBalance,
  type ParsedCounterparty,
  type ParsedStatement,
  type ParsedStatementFile,
  type ParsedStructuredReference,
  type ParsedTransaction,
  type ParsedTransactionDetail,
} from '../bank-import.types';
import {
  cleanText,
  compareDecimals,
  isValidRfReference,
  isoDate,
  negateDecimal,
  normalizeBic,
  normalizeDecimal,
  normalizeIban,
  splitLines,
  sumDecimals,
  truncate,
  yymmddToIso,
} from '../bank-parse.utils';

import { mergeStructuredReferences, pruneUndefined } from './parser-helpers';
import { parseSepaPurpose, type SepaPurposeFields } from './sepa-purpose';

/**
 * SWIFT MT940 (customer statement) / MT942 (interim transaction report) parser, including the German DK `:86:`
 * structure (GVC + `?xx` subfields with SEPA keywords) and the Dutch slash-tagged `:86:` structure.
 */

export interface Mt940ParseOptions {
  /** Forces the format; detected from `:34F:`/`:13D:` when omitted. */
  format?: 'mt940' | 'mt942';
  limits?: BankParseLimits;
}

interface Mt940Field {
  tag: string;
  value: string;
  line: number;
}

interface Info86 {
  national?: string;
  bookingText?: string;
  detail: ParsedTransactionDetail;
}

const TAG_RE = /^:(\d{2}[A-Z]?):/;
const BALANCE_RE = /^([CD])(\d{6})([A-Z]{3})(\d{1,15}(?:,\d{0,4})?)$/;
const STATEMENT_LINE_RE = /^(\d{6})(\d{4})?(RC|RD|EC|ED|C|D)([A-Z])?(\d{1,15}(?:,\d{0,4})?)([NFS])([A-Z0-9]{3})(.*)$/;
const MAX_RAW = 4000;
const MAX_TEXT = 4000;
const FREE_TEXT_LINE = 65;

/** Parses an MT940/MT942 file (one or more statements). */
export function parseMt940(text: string, opts: Mt940ParseOptions = {}): ParsedStatementFile {
  const limits = opts.limits ?? DEFAULT_BANK_PARSE_LIMITS;
  const blocks = tokenize(text, limits);

  if (blocks.length === 0) {
    throw new BankStatementParseError('No MT940/MT942 statement found');
  }

  const format =
    opts.format ?? (blocks.some((b) => b.some((f) => f.tag === '34F' || f.tag === '13D')) ? 'mt942' : 'mt940');
  const warnings: string[] = [];
  const counter = { transactions: 0 };
  const statements = blocks.map((fields, idx) => buildStatement(fields, idx + 1, format, limits, warnings, counter));

  return { format, statements, warnings };
}

function tokenize(text: string, limits: BankParseLimits): Mt940Field[][] {
  // Some Sparkasse exports use `@@` as line separator.
  const lines = splitLines(text.replace(/@@/g, '\n'), limits.maxLineLength);
  const blocks: Mt940Field[][] = [];
  const state: { current: Mt940Field[] | null; field: Mt940Field | null } = { current: null, field: null };
  const finish = (): void => {
    if (state.current && state.current.length > 0) {
      blocks.push(state.current);

      if (blocks.length > limits.maxStatements) {
        throw new BankStatementParseError('Too many statements in file');
      }
    }

    state.current = null;
    state.field = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];

    // SWIFT envelope: `{1:...}{2:...}{4:` header, `-}` end of text block, `{5:...}` trailer.
    if (line.startsWith('{')) {
      const body = line.indexOf('{4:');

      if (body === -1) {
        continue;
      }

      finish();
      line = line.slice(body + 3);
    }

    const trimmed = line.trim();

    if (trimmed === '-' || trimmed.startsWith('-}')) {
      finish();
      continue;
    }

    if (trimmed === '') {
      continue;
    }

    const match = TAG_RE.exec(line);

    if (match) {
      const tag = match[1];

      if (tag === '20' && state.current && state.current.length > 0) {
        finish();
      }

      const field: Mt940Field = { tag, value: line.slice(match[0].length), line: i + 1 };

      state.current = state.current ?? [];
      state.current.push(field);
      state.field = field;
    } else if (state.field) {
      state.field.value += `\n${line}`;
    }
    // Lines outside any field (bank headers such as `ABNANL2A` / `940`) are ignored.
  }

  finish();

  return blocks;
}

function buildStatement(
  fields: Mt940Field[],
  index: number,
  format: 'mt940' | 'mt942',
  limits: BankParseLimits,
  warnings: string[],
  counter: { transactions: number },
): ParsedStatement {
  const label = `statement ${index}`;
  const isInterim = format === 'mt942';
  let currency: string | undefined;

  // First pass: currency from balances (or the MT942 floor limit).
  for (const field of fields) {
    if (/^(60[FM]?|62[FM]?|64|34F)$/.test(field.tag)) {
      const ccy = /^[A-Z]{3}/.exec(field.value.trim().replace(/^[CD]?\d{6}/, ''));

      if (ccy) {
        currency = ccy[0];
        break;
      }
    }
  }

  const statement: ParsedStatement = {
    kind: isInterim ? 'intraday' : 'statement',
    account: {},
    transactions: [],
  };
  let opening: ParsedBalance | undefined;
  let closing: ParsedBalance | undefined;
  let entryNumber = 0;

  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    const fieldLocator = `${label} :${field.tag}: (line ${field.line})`;

    switch (field.tag) {
      case '20':
        setIf(statement, 'statementId', cleanText(field.value));
        break;
      case '25':
        statement.account = parseAccount(field.value);
        break;
      case '28':
      case '28C':
        setIf(statement, 'sequenceNumber', cleanText(field.value));
        break;
      case '60':
      case '60F':
      case '60M':
        opening = opening ?? parseBalance(field.value, fieldLocator);
        break;
      case '62':
      case '62F':
      case '62M':
        closing = parseBalance(field.value, fieldLocator);
        break;
      case '64':
        statement.availableBalance = parseBalance(field.value, fieldLocator);
        break;

      case '13D': {
        const date = /^(\d{6})/.exec(field.value.trim());

        if (date) {
          statement.periodTo = yymmddToIso(date[1], fieldLocator);
        }

        break;
      }

      case '61': {
        const next = fields[i + 1];
        const info = next && next.tag === '86' ? next : undefined;

        if (info) {
          i += 1;
        }

        entryNumber += 1;
        counter.transactions += 1;

        if (counter.transactions > limits.maxTransactions) {
          throw new BankStatementParseError('Too many transactions in file', fieldLocator);
        }

        if (!currency) {
          throw new BankStatementParseError('Statement has no currency (missing :60: balance)', label);
        }

        statement.transactions.push(
          parseEntry(field, info, currency, isInterim, `${label} :61: #${entryNumber} (line ${field.line})`, warnings),
        );
        break;
      }

      default:
        // :21:, :65:, :34F:, :90D:, :90C:, statement-level :86: carry nothing we map.
        break;
    }
  }

  if (currency) {
    statement.currency = currency;
  }

  if (opening) {
    statement.openingBalance = opening;
    statement.periodFrom = opening.date;
  }

  if (closing) {
    statement.closingBalance = closing;
    statement.periodTo = closing.date;
  }

  if (!isInterim && opening && closing && opening.currency === closing.currency) {
    const computed = sumDecimals([opening.amount, ...statement.transactions.map((t) => t.amount)]);

    if (compareDecimals(computed, closing.amount) !== 0) {
      warnings.push(
        `${label}: opening balance ${opening.amount} plus entries gives ${computed}, but closing balance is ${closing.amount}`,
      );
    }
  }

  return statement;
}

function parseAccount(value: string): ParsedAccountIdentifier {
  const compact = value.replace(/\s/g, '').toUpperCase();
  const slash = compact.indexOf('/');

  if (slash > 0) {
    const left = compact.slice(0, slash);
    const right = compact.slice(slash + 1);
    const bic = normalizeBic(left);
    const iban = ibanWithOptionalCurrency(right);
    const bankCode = /^\d{3,12}$/.test(left) ? left : undefined;

    if (iban) {
      return pruneUndefined<ParsedAccountIdentifier>({ iban, bic, bankCode }) ?? {};
    }

    return pruneUndefined<ParsedAccountIdentifier>({ accountNumber: stripCurrencySuffix(right), bic, bankCode }) ?? {};
  }

  const iban = ibanWithOptionalCurrency(compact);

  if (iban) {
    return { iban };
  }

  return compact ? { accountNumber: stripCurrencySuffix(compact) } : {};
}

function ibanWithOptionalCurrency(value: string): string | undefined {
  return normalizeIban(value) ?? normalizeIban(stripCurrencySuffix(value));
}

/** `1234567890EUR` → `1234567890` (some banks append the account currency). */
function stripCurrencySuffix(value: string): string {
  return /\d[A-Z]{3}$/.test(value) ? value.slice(0, -3) : value;
}

function parseBalance(value: string, locator: string): ParsedBalance {
  const match = BALANCE_RE.exec(value.trim());

  if (!match) {
    throw new BankStatementParseError('Invalid balance field', locator);
  }

  const amount = normalizeDecimal(match[4], ',');

  return {
    amount: match[1] === 'D' ? negateDecimal(amount) : amount,
    currency: match[3],
    date: yymmddToIso(match[2], locator),
  };
}

function parseEntry(
  field: Mt940Field,
  info: Mt940Field | undefined,
  currency: string,
  isInterim: boolean,
  locator: string,
  warnings: string[],
): ParsedTransaction {
  const lines = field.value.split('\n');
  const match = STATEMENT_LINE_RE.exec(lines[0].trim());

  if (!match) {
    throw new BankStatementParseError('Invalid :61: statement line', locator);
  }

  const [, valueDateRaw, entryDateRaw, mark, , amountRaw, typeId, typeCode, rest] = match;
  const valueDate = yymmddToIso(valueDateRaw, locator);
  let bookingDate = valueDate;

  if (entryDateRaw) {
    try {
      bookingDate = inferEntryDate(valueDate, entryDateRaw, locator);
    } catch {
      warnings.push(`${locator}: invalid entry date ${entryDateRaw}, value date used`);
    }
  }

  const unsigned = normalizeDecimal(amountRaw, ',');
  // C/EC credit, D/ED debit; RC = reversal of a credit (money out), RD = reversal of a debit (money in).
  const negative = mark === 'D' || mark === 'ED' || mark === 'RC';
  const amount = negative ? negateDecimal(unsigned) : unsigned;
  const slashes = rest.indexOf('//');
  const customerRaw = cleanText(slashes === -1 ? rest : rest.slice(0, slashes));
  const customerReference = customerRaw && customerRaw.toUpperCase() !== 'NONREF' ? customerRaw : undefined;
  const bankReference = slashes === -1 ? undefined : cleanText(rest.slice(slashes + 2));
  const supplementary = cleanText(lines.slice(1).join(' '));
  const parsedInfo: Info86 = info ? parse86(info.value) : { detail: {} };
  const detail = parsedInfo.detail;

  // The :61: customer reference often carries the end-to-end id (unless it is the mandate reference).
  if (!detail.endToEndId && customerReference && customerReference !== detail.mandateId) {
    detail.endToEndId = customerReference;
  }

  const transaction: ParsedTransaction = {
    status: isInterim ? 'pending' : 'booked',
    bookingDate,
    valueDate,
    amount,
    currency,
    isReversal: mark === 'RC' || mark === 'RD',
    bankTransactionCode: pruneUndefined({ proprietary: `${typeId}${typeCode}`, national: parsedInfo.national }),
    isBatch: false,
    details: [detail],
    locator,
    raw: truncate(`:61:${field.value}${info ? `\n:86:${info.value}` : ''}`, MAX_RAW),
  };
  const bookingText = parsedInfo.bookingText ?? supplementary;

  if (bookingText) {
    transaction.bookingText = truncate(bookingText, MAX_TEXT);
  }

  if (bankReference) {
    transaction.bankReference = bankReference;
  }

  if (customerReference) {
    transaction.entryReference = customerReference;
  }

  return transaction;
}

/** Entry date `MMDD` takes the value date's year, shifted by one across a Dec/Jan boundary. */
function inferEntryDate(valueDate: string, mmdd: string, locator: string): string {
  const valueYear = Number(valueDate.slice(0, 4));
  const valueMonth = Number(valueDate.slice(5, 7));
  const month = Number(mmdd.slice(0, 2));
  const day = Number(mmdd.slice(2, 4));
  let year = valueYear;

  if (month - valueMonth > 6) {
    year -= 1;
  } else if (valueMonth - month > 6) {
    year += 1;
  }

  return isoDate(year, month, day, locator);
}

/** Parses the `:86:` information to account owner field. */
function parse86(value: string): Info86 {
  const lines = value.split('\n');
  const joined = lines.join('');

  if (/^\d{3}[^A-Za-z0-9\s]\d{2}/.test(joined)) {
    return parseDk86(joined);
  }

  if (joined.startsWith('/') && /\/(TRTP|NAME|REMI|EREF|IBAN|CNTP|BENM|ORDP)\//.test(joined)) {
    return parseDutch86(joined);
  }

  return parseFree86(lines);
}

/** German DK structure: `GVC?00text?10primanota?20…?29 purpose ?30 BLZ ?31 account ?32/?33 name ?34 key ext`. */
function parseDk86(joined: string): Info86 {
  const gvc = joined.slice(0, 3);
  const separator = joined[3];
  const parts = joined.slice(4).split(separator);
  const subfields = new Map<string, string>();
  let purpose = '';
  let name = '';
  let lastCode = '';

  for (const part of parts) {
    const isCoded = /^\d{2}/.test(part);
    const code = isCoded ? part.slice(0, 2) : lastCode;
    const content = isCoded ? part.slice(2) : `${separator}${part}`;

    if ((code >= '20' && code <= '29') || (code >= '60' && code <= '63')) {
      purpose += content;
    } else if (code === '32' || code === '33') {
      name += content;
    } else if (code) {
      subfields.set(code, (subfields.get(code) ?? '') + content);
    }

    lastCode = code;
  }

  const sepa = parseSepaPurpose(purpose);
  const accountRaw = cleanText(subfields.get('31'))?.replace(/\s/g, '');
  const bankRaw = cleanText(subfields.get('30'))?.replace(/\s/g, '');
  const iban = normalizeIban(accountRaw) ?? sepa?.iban;
  const detail = detailFromPurpose(purpose, sepa);
  const counterparty = pruneUndefined<ParsedCounterparty>({
    ...detail.counterparty,
    name: truncate(cleanText(name), 500),
    iban,
    accountNumber: iban ? undefined : accountRaw,
    bic: normalizeBic(bankRaw) ?? sepa?.bic,
  });

  if (counterparty) {
    detail.counterparty = counterparty;
  } else {
    delete detail.counterparty;
  }

  const result: Info86 = { detail };

  setIf(result, 'national', /^\d{3}$/.test(gvc) ? gvc : undefined);
  setIf(result, 'bookingText', cleanText(subfields.get('00')));

  return result;
}

const DUTCH_TAG_RE =
  /\/(TRTP|IBAN|BIC|NAME|REMI|EREF|MARF|CSID|CNTP|ORDP|BENM|ULTC|ULTD|ULTB|PURP|RTRN|ISDT|PREF|ADDR|SVCL|CDTRREFTP|CDTRREF|CD|ISSR)\//g;

/** Dutch (ING, ABN AMRO, Rabobank) slash-tagged structure: `/TRTP/…/IBAN/…/NAME/…/REMI/…/EREF/…`. */
function parseDutch86(joined: string): Info86 {
  const matches = Array.from(joined.matchAll(DUTCH_TAG_RE));
  const detail: ParsedTransactionDetail = {};
  const counterparty: ParsedCounterparty = {};
  const references: ParsedStructuredReference[] = [];
  let bookingText: string | undefined;
  let remittance: string | undefined;
  let party: 'counterparty' | 'ultimate' = 'counterparty';
  let referenceIssuer: string | undefined;

  matches.forEach((match, idx) => {
    const start = (match.index ?? 0) + match[0].length;
    const next = matches[idx + 1];
    const end = next ? (next.index ?? joined.length) : joined.length;
    const value = stripTrailingSlashes(joined.slice(start, end));
    const clean = cleanText(value);

    switch (match[1]) {
      case 'TRTP':
        bookingText = clean;
        break;
      case 'ORDP':
      case 'BENM':
        party = 'counterparty';
        break;
      case 'ULTC':
      case 'ULTD':
      case 'ULTB':
        party = 'ultimate';
        break;
      case 'NAME':
        if (party === 'ultimate') {
          setIf(counterparty, 'ultimateName', clean);
        } else {
          setIf(counterparty, 'name', clean);
        }

        break;

      case 'IBAN': {
        const raw = clean?.replace(/\s/g, '');
        const iban = normalizeIban(raw);

        setIf(counterparty, 'iban', iban);

        if (!iban) {
          setIf(counterparty, 'accountNumber', raw);
        }

        break;
      }

      case 'BIC':
        setIf(counterparty, 'bic', normalizeBic(clean));
        break;

      case 'CNTP': {
        const [account, bic, cpName] = value.split('/');
        const raw = cleanText(account)?.replace(/\s/g, '');
        const iban = normalizeIban(raw);

        setIf(counterparty, 'iban', iban);

        if (!iban) {
          setIf(counterparty, 'accountNumber', raw);
        }

        setIf(counterparty, 'bic', normalizeBic(bic));
        setIf(counterparty, 'name', cleanText(cpName));
        break;
      }

      case 'REMI':
        remittance = parseDutchRemittance(value, references) ?? remittance;
        break;
      case 'CDTRREFTP':
      case 'CD':
        break;
      case 'ISSR':
        referenceIssuer = clean;
        break;

      case 'CDTRREF': {
        const reference = clean?.replace(/\s/g, '');

        if (reference) {
          references.push(structuredReference(reference, referenceIssuer));
        }

        break;
      }

      case 'EREF':
        if (clean && clean.toUpperCase() !== 'NOTPROVIDED') {
          detail.endToEndId = clean;
        }

        break;
      case 'MARF':
        setIf(detail, 'mandateId', clean);
        break;
      case 'CSID':
        setIf(detail, 'creditorId', clean);
        break;
      case 'PREF':
        setIf(detail, 'paymentInformationId', clean);
        break;
      case 'RTRN':
        setIf(detail, 'returnReason', clean);
        break;
      default:
        break;
    }
  });

  const leading = matches.length > 0 ? cleanText(joined.slice(0, matches[0].index ?? 0)) : undefined;
  const finalRemittance = truncate(remittance ?? leading, MAX_TEXT);

  if (finalRemittance) {
    detail.remittance = finalRemittance;
  }

  const refs = mergeStructuredReferences(references, finalRemittance);

  if (refs) {
    detail.structuredReferences = refs;
  }

  if (Object.keys(counterparty).length > 0) {
    detail.counterparty = counterparty;
  }

  return bookingText ? { bookingText, detail } : { detail };
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;

  while (end > 0 && value[end - 1] === '/') {
    end -= 1;
  }

  return value.slice(0, end);
}

/** `USTD//free text`, `STRD/CUR/1234567890123456` or plain text. Structured refs are pushed to `references`. */
function parseDutchRemittance(value: string, references: ParsedStructuredReference[]): string | undefined {
  if (value.startsWith('USTD/')) {
    return cleanText(value.slice(value.startsWith('USTD//') ? 6 : 5));
  }

  if (value.startsWith('STRD/')) {
    const [issuer, ...referenceParts] = value.slice(5).split('/');
    const reference = referenceParts.join('').replace(/\s/g, '');

    if (reference) {
      references.push(structuredReference(reference, cleanText(issuer)));
    }

    return undefined;
  }

  return cleanText(value);
}

function structuredReference(reference: string, issuer: string | undefined): ParsedStructuredReference {
  const type = isValidRfReference(reference) ? 'SCOR' : 'OTHER';

  return issuer ? { type, reference, issuer } : { type, reference };
}

function parseFree86(lines: string[]): Info86 {
  // Lines are wrapped at 65 characters: a full line was cut mid-text, a shorter one ended a phrase.
  let text = '';

  lines.forEach((line, idx) => {
    if (idx === 0) {
      text = line;
    } else {
      text += lines[idx - 1].length >= FREE_TEXT_LINE ? line : ` ${line}`;
    }
  });

  const cleaned = truncate(cleanText(text), MAX_TEXT);

  return { detail: detailFromPurpose(cleaned ?? '', parseSepaPurpose(cleaned)) };
}

function detailFromPurpose(purpose: string, sepa: SepaPurposeFields | undefined): ParsedTransactionDetail {
  const detail: ParsedTransactionDetail = {};
  const remittance = truncate(sepa ? sepa.remittance : cleanText(purpose), MAX_TEXT);

  if (sepa) {
    setIf(detail, 'endToEndId', sepa.endToEndId);
    setIf(detail, 'mandateId', sepa.mandateId);
    setIf(detail, 'creditorId', sepa.creditorId);
    setIf(detail, 'paymentInformationId', sepa.customerReference);

    const ultimateName = sepa.ultimateDebtor ?? sepa.ultimateCreditor;

    if (ultimateName) {
      detail.counterparty = { ultimateName };
    }
  }

  if (remittance) {
    detail.remittance = remittance;
  }

  const refs = mergeStructuredReferences([], remittance);

  if (refs) {
    detail.structuredReferences = refs;
  }

  return detail;
}

function setIf<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}
