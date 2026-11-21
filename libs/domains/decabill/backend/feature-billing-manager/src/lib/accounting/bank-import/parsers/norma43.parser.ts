import {
  BankStatementParseError,
  DEFAULT_BANK_PARSE_LIMITS,
  type BankParseLimits,
  type ParsedStatement,
  type ParsedStatementFile,
  type ParsedTransaction,
} from '../bank-import.types';
import {
  compareDecimals,
  currencyFromNumeric,
  ibanFromBban,
  impliedDecimal,
  sumDecimals,
  yymmddToIso,
} from '../bank-parse.utils';

import {
  ParseBudget,
  checkBalanceContinuity,
  field,
  finalizeDetail,
  rawText,
  signed,
  splitFixedWidthRecords,
  type FixedWidthRecord,
} from './parser-common';

/**
 * AEB / CSB Cuaderno 43 ("Norma 43"), 80-character records. Positions are 1-based and inclusive.
 *
 * 11 – account header
 *   3-6 bank · 7-10 office · 11-20 account · 21-26 start date YYMMDD · 27-32 end date YYMMDD
 *   33 balance sign (1 debit, 2 credit) · 34-47 initial balance (14, 2 implied decimals) · 48-50 currency (ISO
 *   4217 numeric) · 51 information mode · 52-77 account name · 78-80 free
 * 22 – movement
 *   3-6 free · 7-10 origin office · 11-16 operation date YYMMDD · 17-22 value date YYMMDD · 23-24 common concept
 *   25-27 own concept · 28 sign (1 debit, 2 credit) · 29-42 amount (14/2) · 43-52 document number
 *   53-64 reference 1 · 65-80 reference 2
 * 23 – complementary concept (up to 5 per movement)
 *   3-4 data code (01-05) · 5-42 concept · 43-80 concept
 * 24 – currency equivalence
 *   3-4 data code · 5-7 original currency (numeric) · 8-21 amount (14/2)
 * 33 – account trailer
 *   3-6 bank · 7-10 office · 11-20 account · 21-25 debit count · 26-39 debit total · 40-44 credit count
 *   45-58 credit total · 59 final balance sign · 60-73 final balance (14/2) · 74-76 currency
 * 88 – end of file: 3-20 nines · 21-26 record count
 */

const RECORD_LENGTH = 80;
const CCC_WEIGHTS = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6];

function cccDigit(digits: string): number {
  let total = 0;

  for (let i = 0; i < digits.length; i += 1) {
    total += Number(digits[i]) * CCC_WEIGHTS[i];
  }

  const digit = 11 - (total % 11);

  if (digit === 11) {
    return 0;
  }

  return digit === 10 ? 1 : digit;
}

/** Spanish CCC control digits ("dígitos de control") for bank (4) + office (4) + account (10). */
export function cccControlDigits(bank: string, office: string, account: string): string {
  return `${cccDigit(`00${bank}${office}`)}${cccDigit(account)}`;
}

interface Norma43Movement {
  transaction: ParsedTransaction;
  records: string[];
  concepts: string[];
  counterpartyName?: string;
  reference2?: string;
  originalAmount?: string;
  originalCurrency?: string;
}

interface Norma43Context {
  statement: ParsedStatement;
  firstIndex: number;
  movements: Norma43Movement[];
}

export function parseNorma43(text: string, limits: BankParseLimits = DEFAULT_BANK_PARSE_LIMITS): ParsedStatementFile {
  const records = splitFixedWidthRecords(text, RECORD_LENGTH);
  const budget = new ParseBudget(limits);
  const warnings: string[] = [];
  const statements: ParsedStatement[] = [];
  let context: Norma43Context | undefined;

  if (records.length === 0 || !records[0].text.startsWith('11')) {
    throw new BankStatementParseError('Not a Norma 43 file (expected record 11)', 'record 1');
  }

  const close = (reason?: string): void => {
    if (!context) {
      return;
    }

    if (reason) {
      warnings.push(`Account at record ${context.firstIndex} ${reason}`);
    }

    for (const movement of context.movements) {
      finalizeMovement(movement);
    }

    checkBalanceContinuity(context.statement, `Norma 43 account at record ${context.firstIndex}`, warnings);
    statements.push(context.statement);
    context = undefined;
  };

  for (const record of records) {
    const r = record.text;
    const locator = `record ${record.index}`;
    const code = field(r, 1, 2);

    switch (code) {
      case '11':
        close('has no trailer record 33');
        budget.addStatement(locator);
        context = openAccount(record);
        break;

      case '22':
        if (!context) {
          throw new BankStatementParseError('Movement outside of an account', locator);
        }

        budget.addTransaction(locator);
        context.movements.push(parseMovement(record, context.statement));
        break;

      case '23':

      case '24': {
        const movement = context ? context.movements[context.movements.length - 1] : undefined;

        if (!movement) {
          warnings.push(`Record ${code} without movement ignored (${locator})`);
          break;
        }

        movement.records.push(r);

        if (code === '23') {
          if (field(r, 3, 4) === '01' && movement.concepts.length === 0) {
            movement.counterpartyName = field(r, 5, 42);
          }

          movement.concepts.push(field(r, 5, 42), field(r, 43, 80));
        } else {
          const currency = currencyFromNumeric(field(r, 5, 7));

          movement.originalCurrency = currency;
          movement.originalAmount = signed(
            impliedDecimal(field(r, 8, 21), currency === 'JPY' ? 0 : 2),
            movement.transaction.amount.startsWith('-'),
          );

          if (!currency) {
            warnings.push(`Unknown original currency "${field(r, 5, 7)}" (${locator})`);
          }
        }

        break;
      }

      case '33': {
        if (!context) {
          warnings.push(`Trailer without account ignored (${locator})`);
          break;
        }

        applyTrailer(context, record, warnings);
        close();
        break;
      }

      case '88':
        close('has no trailer record 33');
        break;

      default:
        warnings.push(`Unknown Norma 43 record type "${code}" ignored (${locator})`);
    }
  }

  close('has no trailer record 33');

  return { format: 'norma43', statements, warnings };
}

function currencyOf(raw: string, locator: string): string {
  const currency = currencyFromNumeric(raw);

  if (!currency) {
    throw new BankStatementParseError(`Unknown currency code "${raw}"`, locator);
  }

  return currency;
}

function openAccount(record: FixedWidthRecord): Norma43Context {
  const r = record.text;
  const locator = `record ${record.index}`;
  const bank = field(r, 3, 6);
  const office = field(r, 7, 10);
  const account = field(r, 11, 20);
  const currency = currencyOf(field(r, 48, 50), locator);
  const periodFrom = yymmddToIso(field(r, 21, 26), locator);
  const periodTo = yymmddToIso(field(r, 27, 32), locator);
  const numeric = /^\d{4}$/.test(bank) && /^\d{4}$/.test(office) && /^\d{10}$/.test(account);
  const ccc = numeric ? `${bank}${office}${cccControlDigits(bank, office, account)}${account}` : undefined;

  return {
    firstIndex: record.index,
    movements: [],
    statement: {
      kind: 'statement',
      account: ccc
        ? { iban: ibanFromBban('ES', ccc), accountNumber: ccc, bankCode: bank }
        : { accountNumber: `${bank}${office}${account}`.trim(), bankCode: bank.trim() || undefined },
      currency,
      periodFrom,
      periodTo,
      openingBalance: {
        amount: signed(impliedDecimal(field(r, 34, 47), 2), field(r, 33, 33) === '1'),
        currency,
        date: periodFrom,
      },
      transactions: [],
    },
  };
}

function parseMovement(record: FixedWidthRecord, statement: ParsedStatement): Norma43Movement {
  const r = record.text;
  const locator = `record ${record.index}`;
  const valueRaw = field(r, 17, 22);
  const documentNumber = field(r, 43, 52).trim();
  const reference1 = field(r, 53, 64).trim();
  const transaction: ParsedTransaction = {
    status: 'booked',
    bookingDate: yymmddToIso(field(r, 11, 16), locator),
    valueDate: /^0*$/.test(valueRaw.trim()) ? undefined : yymmddToIso(valueRaw, locator),
    amount: signed(impliedDecimal(field(r, 29, 42), 2), field(r, 28, 28) === '1'),
    currency: statement.currency ?? 'EUR',
    isReversal: false,
    bankTransactionCode: { national: field(r, 23, 24), proprietary: field(r, 25, 27) },
    entryReference: /^0*$/.test(documentNumber) ? undefined : documentNumber,
    bankReference: /^0*$/.test(reference1) ? undefined : reference1,
    isBatch: false,
    details: [],
    locator,
  };

  statement.transactions.push(transaction);

  return { transaction, records: [r], concepts: [], reference2: field(r, 65, 80).trim() || undefined };
}

function finalizeMovement(movement: Norma43Movement): void {
  const remittance = movement.concepts.length > 0 ? movement.concepts.join(' ') : movement.reference2;

  movement.transaction.details = [
    finalizeDetail({
      remittance,
      counterparty: { name: movement.counterpartyName },
      originalAmount: movement.originalAmount,
      originalCurrency: movement.originalCurrency,
    }),
  ];
  movement.transaction.raw = rawText(movement.records);
}

function applyTrailer(context: Norma43Context, record: FixedWidthRecord, warnings: string[]): void {
  const r = record.text;
  const locator = `record ${record.index}`;
  const { statement } = context;
  const currency = statement.currency ?? currencyOf(field(r, 74, 76), locator);
  const debits = statement.transactions.filter((tx) => tx.amount.startsWith('-'));
  const credits = statement.transactions.filter((tx) => !tx.amount.startsWith('-'));
  const debitTotal = impliedDecimal(field(r, 26, 39), 2);
  const creditTotal = impliedDecimal(field(r, 45, 58), 2);

  if (
    Number(field(r, 21, 25)) !== debits.length ||
    Number(field(r, 40, 44)) !== credits.length ||
    compareDecimals(sumDecimals(['0.00', ...credits.map((tx) => tx.amount)]), creditTotal) !== 0 ||
    compareDecimals(sumDecimals(['0.00', ...debits.map((tx) => tx.amount)]), `-${debitTotal}`) !== 0
  ) {
    warnings.push(`Account trailer counts/totals do not match the movements (${locator})`);
  }

  statement.closingBalance = {
    amount: signed(impliedDecimal(field(r, 60, 73), 2), field(r, 59, 59) === '1'),
    currency,
    date: statement.periodTo ?? statement.openingBalance?.date ?? '',
  };
}
