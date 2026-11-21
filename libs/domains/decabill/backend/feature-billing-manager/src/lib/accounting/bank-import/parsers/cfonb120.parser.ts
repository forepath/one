import {
  BankStatementParseError,
  DEFAULT_BANK_PARSE_LIMITS,
  type BankParseLimits,
  type ParsedAccountIdentifier,
  type ParsedBalance,
  type ParsedCounterparty,
  type ParsedStatement,
  type ParsedStatementFile,
  type ParsedTransaction,
  type ParsedTransactionDetail,
} from '../bank-import.types';
import {
  ddmmyyToIso,
  ibanFromBban,
  impliedDecimal,
  normalizeBic,
  normalizeCurrency,
  normalizeIban,
} from '../bank-parse.utils';

import {
  ParseBudget,
  checkBalanceContinuity,
  field,
  fillPeriodFromTransactions,
  finalizeDetail,
  rawText,
  splitFixedWidthRecords,
  type FixedWidthRecord,
} from './parser-common';

/**
 * CFONB 120 ("relevé de compte 120 caractères"). Positions are 1-based and inclusive.
 *
 * 01 / 07 – old / new balance
 *   3-7 bank code · 8-11 reserved · 12-16 branch (guichet) · 17-19 currency (alpha) · 20 number of decimals
 *   22-32 account number (11) · 35-40 date DDMMYY · 91-104 balance (14, sign overpunched in the last char)
 * 04 – movement
 *   3-7 bank · 8-11 internal operation code · 12-16 branch · 17-19 currency · 20 decimals · 22-32 account
 *   33-34 interbank operation code · 35-40 booking date DDMMYY · 41-42 rejection code · 43-48 value date DDMMYY
 *   49-79 label (31) · 82-88 entry number (7) · 89 exemption indicator · 90 unavailability indicator
 *   91-104 amount (14, overpunched sign) · 105-120 reference (16)
 * 05 – movement complement
 *   3-34 as record 04 · 35-40 booking date · 46-48 qualifier · 49-118 information (70)
 *
 * Overpunch (last amount character): `{` = +0, `A`–`I` = +1..9, `}` = −0, `J`–`R` = −1..9.
 * Negative movements are debits (money out); balances are positive when in credit.
 *
 * 05 qualifiers mapped: LIB/LCC/LC2/LCS/LCZ (label continuation → remittance), NPY/IPY (payer name / id),
 * NBE/IBE (beneficiary name / id), NPO/NBU (ultimate payer / beneficiary), RCN (end-to-end / client reference),
 * REF (operation reference → instructionId), MMO (original amount: currency 3 + decimals 1 + amount 14),
 * BIC/BDB (counterparty BIC). Unknown qualifiers are kept in `raw` only.
 */

const RECORD_LENGTH = 120;
const RIB_LETTERS: Record<string, string> = {
  A: '1',
  B: '2',
  C: '3',
  D: '4',
  E: '5',
  F: '6',
  G: '7',
  H: '8',
  I: '9',
  J: '1',
  K: '2',
  L: '3',
  M: '4',
  N: '5',
  O: '6',
  P: '7',
  Q: '8',
  R: '9',
  S: '2',
  T: '3',
  U: '4',
  V: '5',
  W: '6',
  X: '7',
  Y: '8',
  Z: '9',
};
const REMITTANCE_QUALIFIERS = new Set(['LIB', 'LCC', 'LC2', 'LCS', 'LCZ']);

/** French RIB key: 97 − ((89 × bank + 15 × branch + 3 × account) mod 97), letters mapped A,J=1 B,K,S=2 … */
export function ribKey(bank: string, branch: string, account: string): string {
  const digits = (value: string): string =>
    value
      .toUpperCase()
      .split('')
      .map((char) => RIB_LETTERS[char] ?? char)
      .join('');
  const mod = (value: string): number => {
    let remainder = 0;

    for (const char of digits(value)) {
      remainder = (remainder * 10 + Number(char)) % 97;
    }

    return remainder;
  };
  const key = 97 - ((89 * mod(bank) + 15 * mod(branch) + 3 * mod(account)) % 97);

  return String(key).padStart(2, '0');
}

/** Decodes a CFONB amount field with an overpunched sign in its last character. */
export function decodeOverpunch(value: string, decimals: number, locator?: string): string {
  const trimmed = value.trim();
  const last = trimmed.slice(-1).toUpperCase();
  let digit: number;
  let negative = false;

  if (last === '{') {
    digit = 0;
  } else if (last === '}') {
    digit = 0;
    negative = true;
  } else if (last >= 'A' && last <= 'I') {
    digit = last.charCodeAt(0) - 64;
  } else if (last >= 'J' && last <= 'R') {
    digit = last.charCodeAt(0) - 73;
    negative = true;
  } else if (/^\d$/.test(last)) {
    digit = Number(last);
  } else {
    throw new BankStatementParseError(`Invalid CFONB amount "${value}"`, locator);
  }

  const body = trimmed.slice(0, -1);

  if (!/^\d*$/.test(body)) {
    throw new BankStatementParseError(`Invalid CFONB amount "${value}"`, locator);
  }

  const amount = impliedDecimal(`${body}${digit}`, decimals);

  return negative && !/^[0.]+$/.test(amount) ? `-${amount}` : amount;
}

interface CfonbMovement {
  transaction: ParsedTransaction;
  records: string[];
  remittance: string[];
  payer: ParsedCounterparty;
  beneficiary: ParsedCounterparty;
  bic?: string;
  detail: ParsedTransactionDetail;
}

interface CfonbContext {
  statement: ParsedStatement;
  firstIndex: number;
  movements: CfonbMovement[];
}

export function parseCfonb120(text: string, limits: BankParseLimits = DEFAULT_BANK_PARSE_LIMITS): ParsedStatementFile {
  const records = splitFixedWidthRecords(text, RECORD_LENGTH);
  const budget = new ParseBudget(limits);
  const warnings: string[] = [];
  const statements: ParsedStatement[] = [];
  let context: CfonbContext | undefined;

  if (records.length === 0 || !/^0[1457]/.test(records[0].text)) {
    throw new BankStatementParseError('Not a CFONB 120 file', 'record 1');
  }

  const close = (reason?: string): void => {
    if (!context) {
      return;
    }

    if (reason) {
      warnings.push(`Statement at record ${context.firstIndex} ${reason}`);
    }

    for (const movement of context.movements) {
      finalizeMovement(movement);
    }

    fillPeriodFromTransactions(context.statement);
    checkBalanceContinuity(context.statement, `CFONB statement at record ${context.firstIndex}`, warnings);
    statements.push(context.statement);
    context = undefined;
  };

  for (const record of records) {
    const r = record.text;
    const locator = `record ${record.index}`;
    const code = field(r, 1, 2);

    switch (code) {
      case '01':
        close('has no new balance record 07');
        budget.addStatement(locator);
        context = {
          firstIndex: record.index,
          movements: [],
          statement: {
            kind: 'statement',
            account: accountOf(r),
            currency: currencyOf(r, locator),
            openingBalance: balanceOf(r, locator),
            transactions: [],
          },
        };
        context.statement.periodFrom = context.statement.openingBalance?.date;
        break;

      case '04': {
        if (!context) {
          throw new BankStatementParseError('Movement outside of a statement', locator);
        }

        budget.addTransaction(locator);

        const movement = parseMovement(record, context.statement);

        context.movements.push(movement);
        context.statement.transactions.push(movement.transaction);
        break;
      }

      case '05': {
        const movement = context ? context.movements[context.movements.length - 1] : undefined;

        if (!movement) {
          warnings.push(`Complement record without movement ignored (${locator})`);
          break;
        }

        applyComplement(movement, r, warnings, locator);
        break;
      }

      case '07': {
        if (!context) {
          warnings.push(`New balance without old balance ignored (${locator})`);
          break;
        }

        context.statement.closingBalance = balanceOf(r, locator);
        context.statement.periodTo = context.statement.closingBalance.date;
        close();
        break;
      }

      default:
        warnings.push(`Unknown CFONB record type "${code}" ignored (${locator})`);
    }
  }

  close('has no new balance record 07');

  return { format: 'cfonb120', statements, warnings };
}

function decimalsOf(r: string): number {
  const value = field(r, 20, 20);

  return /^\d$/.test(value) ? Number(value) : 2;
}

function currencyOf(r: string, locator: string): string {
  const currency = normalizeCurrency(field(r, 17, 19));

  if (!currency) {
    throw new BankStatementParseError(`Invalid currency "${field(r, 17, 19)}"`, locator);
  }

  return currency;
}

function accountOf(r: string): ParsedAccountIdentifier {
  const bank = field(r, 3, 7);
  const branch = field(r, 12, 16);
  const account = field(r, 22, 32);

  if (/^\d{5}$/.test(bank) && /^\d{5}$/.test(branch) && /^[A-Z0-9]{11}$/i.test(account)) {
    const key = ribKey(bank, branch, account);
    const iban = normalizeIban(ibanFromBban('FR', `${bank}${branch}${account.toUpperCase()}${key}`));

    return iban
      ? { iban, accountNumber: `${bank}${branch}${account}${key}`, bankCode: bank }
      : { accountNumber: `${bank}${branch}${account}${key}`, bankCode: bank };
  }

  return { accountNumber: `${bank}${branch}${account}`.trim() };
}

function balanceOf(r: string, locator: string): ParsedBalance {
  return {
    amount: decodeOverpunch(field(r, 91, 104), decimalsOf(r), locator),
    currency: currencyOf(r, locator),
    date: ddmmyyToIso(field(r, 35, 40), locator),
  };
}

function parseMovement(record: FixedWidthRecord, statement: ParsedStatement): CfonbMovement {
  const r = record.text;
  const locator = `record ${record.index}`;
  const valueRaw = field(r, 43, 48);
  const rejection = field(r, 41, 42).trim();
  const entryNumber = field(r, 82, 88).trim();
  const reference = field(r, 105, 120).trim();
  const internalCode = field(r, 8, 11).trim();
  const transaction: ParsedTransaction = {
    status: 'booked',
    bookingDate: ddmmyyToIso(field(r, 35, 40), locator),
    valueDate: /^0*$/.test(valueRaw.trim()) ? undefined : ddmmyyToIso(valueRaw, locator),
    amount: decodeOverpunch(field(r, 91, 104), decimalsOf(r), locator),
    currency: normalizeCurrency(field(r, 17, 19), statement.currency) ?? 'EUR',
    isReversal: rejection !== '' && !/^0+$/.test(rejection),
    bankTransactionCode: {
      national: field(r, 33, 34),
      proprietary: internalCode || undefined,
    },
    bookingText: field(r, 49, 79).trim() || undefined,
    entryReference: entryNumber || undefined,
    isBatch: false,
    details: [],
    locator,
  };

  return {
    transaction,
    records: [r],
    remittance: [],
    payer: {},
    beneficiary: {},
    detail: { instructionId: reference || undefined },
  };
}

function applyComplement(movement: CfonbMovement, r: string, warnings: string[], locator: string): void {
  const qualifier = field(r, 46, 48).toUpperCase();
  const value = field(r, 49, 118);
  const trimmed = value.trim();

  movement.records.push(r);

  if (REMITTANCE_QUALIFIERS.has(qualifier)) {
    movement.remittance.push(value);

    return;
  }

  switch (qualifier) {
    case 'NPY':
      movement.payer.name = trimmed;
      break;
    case 'NBE':
      movement.beneficiary.name = trimmed;
      break;
    case 'NPO':
      movement.payer.ultimateName = trimmed;
      break;
    case 'NBU':
      movement.beneficiary.ultimateName = trimmed;
      break;
    case 'IPY':

    case 'IBE': {
      const target = qualifier === 'IPY' ? movement.payer : movement.beneficiary;
      const iban = normalizeIban(trimmed.split(' ')[0]);

      if (iban) {
        target.iban = iban;
      } else if (trimmed) {
        target.accountNumber = trimmed;
      }

      break;
    }

    case 'RCN':
      movement.detail.endToEndId = trimmed || undefined;
      break;
    case 'REF':
      movement.detail.instructionId = movement.detail.instructionId ?? (trimmed || undefined);
      break;
    case 'BIC':
    case 'BDB':
      movement.bic = normalizeBic(trimmed.split(' ')[0]);
      break;

    case 'MMO': {
      const match = /^([A-Z]{3})\s*(\d)\s*(\d{1,14})/.exec(trimmed.toUpperCase());

      if (match) {
        const original = impliedDecimal(match[3], Number(match[2]));

        movement.detail.originalCurrency = match[1];
        movement.detail.originalAmount = movement.transaction.amount.startsWith('-') ? `-${original}` : original;
      } else {
        warnings.push(`Unreadable MMO original amount ignored (${locator})`);
      }

      break;
    }

    default:
      break;
  }
}

function finalizeMovement(movement: CfonbMovement): void {
  const incoming = !movement.transaction.amount.startsWith('-');
  const primary = incoming ? movement.payer : movement.beneficiary;
  const secondary = incoming ? movement.beneficiary : movement.payer;
  const counterparty: ParsedCounterparty = Object.keys(primary).length > 0 ? { ...primary } : { ...secondary };

  if (movement.bic) {
    counterparty.bic = movement.bic;
  }

  movement.transaction.details = [
    finalizeDetail({
      ...movement.detail,
      remittance: [movement.transaction.bookingText ?? '', ...movement.remittance].join(' '),
      counterparty,
    }),
  ];
  movement.transaction.raw = rawText(movement.records);
}
