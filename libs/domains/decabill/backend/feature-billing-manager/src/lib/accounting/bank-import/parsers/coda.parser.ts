import {
  BankStatementParseError,
  DEFAULT_BANK_PARSE_LIMITS,
  type BankParseLimits,
  type ParsedAccountIdentifier,
  type ParsedBalance,
  type ParsedStatement,
  type ParsedStatementFile,
  type ParsedTransaction,
  type ParsedTransactionDetail,
} from '../bank-import.types';
import {
  ddmmyyToIso,
  ibanFromBban,
  impliedDecimal,
  isValidBelgianOgm,
  normalizeBic,
  normalizeCurrency,
  normalizeIban,
} from '../bank-parse.utils';

import {
  ParseBudget,
  checkBalanceContinuity,
  compactObject,
  field,
  fillPeriodFromTransactions,
  finalizeDetail,
  rawText,
  signed,
  splitFixedWidthRecords,
  type FixedWidthRecord,
} from './parser-common';

/**
 * Febelfin CODA 2.x (coded statement of account), 128-character records. Positions below are 1-based and
 * inclusive, following the Febelfin "CODA – version 2.6" standard.
 *
 * Record 0 – header
 *   1 `0` · 2-5 zeros · 6-11 creation date DDMMYY · 12-14 bank identification number · 15-16 application code `05`
 *   17 duplicate `D` · 25-34 file reference · 35-60 addressee name · 61-71 BIC · 72-82 account holder id
 *   84-88 separate application · 89-104 transaction reference · 105-120 related reference · 128 version (`2`)
 *
 * Record 1 – old balance
 *   1 `1` · 2 account structure (0 Belgian, 1 foreign, 2 Belgian IBAN, 3 foreign IBAN) · 3-5 paper statement no.
 *   6-42 account + currency: structure 0 → 6-17 account (12), 19-21 currency
 *                             structure 1 → 6-39 account (34), 40-42 currency
 *                             structure 2 → 6-36 IBAN (31), 40-42 currency
 *                             structure 3 → 6-39 IBAN (34), 40-42 currency
 *   43 sign (0 credit, 1 debit) · 44-58 balance (15, 3 implied decimals) · 59-64 balance date DDMMYY
 *   65-90 account holder name · 91-125 account description · 126-128 CODA statement sequence number
 *
 * Record 2.1 – movement
 *   1-2 `21` · 3-6 continuous sequence number · 7-10 detail number (0000 = movement, >0 = globalisation detail)
 *   11-31 bank reference · 32 sign (0 credit, 1 debit) · 33-47 amount (15, 3 implied decimals)
 *   48-53 value date DDMMYY (000000 = unknown) · 54-61 transaction code (54 type, 55-56 family, 57-58 operation,
 *   59-61 category) · 62 communication type (0 free, 1 structured) · 63-115 communication (53; structured:
 *   63-65 type, 101/102 = OGM in 66-77) · 116-121 entry date DDMMYY · 122-124 statement sequence
 *   125 globalisation code · 126 next code · 128 link code
 *
 * Record 2.2 – movement continuation
 *   1-2 `22` · 3-6 sequence · 7-10 detail · 11-63 communication (53) · 64-98 customer reference / end-to-end (35)
 *   99-109 counterparty BIC (11) · 113 R-transaction type (1 reject, 2 return, 3 refund, 4 reversal,
 *   5 cancellation) · 114-117 ISO return reason · 118-121 category purpose · 122-125 purpose
 *
 * Record 2.3 – movement continuation
 *   1-2 `23` · 3-6 sequence · 7-10 detail · 11-44 counterparty account/IBAN (34) · 45-47 its currency
 *   48-82 counterparty name (35) · 83-125 communication (43)
 *
 * Record 3.x – information (linked to the movement with the same sequence + detail number)
 *   3.1: 11-31 bank reference · 32-39 transaction code · 40 communication structure · 41-113 communication (73;
 *        structured: 41-43 type, 44-113 content)
 *   3.2: 11-115 communication (105) · 3.3: 11-100 communication (90)
 *
 * Record 4 – free message (11-32 blank, 33-112 text) – ignored.
 * Record 8 – new balance: 2-4 paper statement no. · 5-41 account + currency · 42 sign · 43-57 balance (15/3)
 *   58-63 balance date DDMMYY
 * Record 9 – trailer: 17-22 record count · 23-37 debit total · 38-52 credit total · 128 multiple-file code
 */

const RECORD_LENGTH = 128;

interface CodaMovement {
  sequence: string;
  detail: string;
  firstIndex: number;
  records: string[];
  bankReference?: string;
  negative: boolean;
  amount: string;
  valueDate?: string;
  entryDate?: string;
  transactionCode: string;
  structured: boolean;
  structuredType?: string;
  communication: string;
  endToEndId?: string;
  bic?: string;
  rTransactionType?: string;
  returnReason?: string;
  counterpartyAccount?: string;
  counterpartyName?: string;
  information: string[];
}

interface CodaContext {
  statement: ParsedStatement;
  firstIndex: number;
  movements: Map<string, CodaMovement>;
}

interface CodaHeader {
  creationDate?: string;
  bankCode?: string;
  bic?: string;
}

export function parseCoda(text: string, limits: BankParseLimits = DEFAULT_BANK_PARSE_LIMITS): ParsedStatementFile {
  const records = splitFixedWidthRecords(text, RECORD_LENGTH);
  const budget = new ParseBudget(limits);
  const warnings: string[] = [];
  const statements: ParsedStatement[] = [];
  let header: CodaHeader = {};
  let formatVersion: string | undefined;
  let context: CodaContext | undefined;

  if (records.length === 0 || !/^[0-9]$/.test(records[0].text[0])) {
    throw new BankStatementParseError('Not a CODA file');
  }

  const close = (locator: string, reason?: string): void => {
    if (!context) {
      return;
    }

    if (reason) {
      warnings.push(`Statement starting at record ${context.firstIndex} ${reason} (${locator})`);
    }

    statements.push(finalizeStatement(context, warnings));
    context = undefined;
  };

  for (const record of records) {
    const r = record.text;
    const locator = `record ${record.index}`;
    const type = r[0];

    switch (type) {
      case '0': {
        close(locator, 'has no new balance record');
        header = {
          creationDate: codaDate(field(r, 6, 11), locator),
          bankCode: field(r, 12, 14).trim() || undefined,
          bic: normalizeBic(field(r, 61, 71)),
        };
        formatVersion = formatVersion ?? (field(r, 128, 128).trim() || undefined);
        break;
      }

      case '1': {
        close(locator, 'has no new balance record');
        budget.addStatement(locator);
        context = openStatement(record, header);
        break;
      }

      case '2':

      case '3': {
        if (!context) {
          warnings.push(`Movement record outside of a statement ignored (${locator})`);
          break;
        }

        if (type === '2') {
          applyMovementRecord(context, record, warnings, budget);
        } else {
          applyInformationRecord(context, record, warnings);
        }

        break;
      }

      case '4':
        // Free messages carry bank notices only.
        break;

      case '8': {
        if (!context) {
          warnings.push(`New balance record without old balance ignored (${locator})`);
          break;
        }

        const currency = context.statement.currency ?? 'EUR';
        const amount = signed(impliedDecimal(field(r, 43, 57), 3), field(r, 42, 42) === '1');
        const date = codaDate(field(r, 58, 63), locator) ?? header.creationDate;

        if (date) {
          context.statement.closingBalance = { amount, currency, date };
          context.statement.periodTo = date;
        }

        close(locator);
        break;
      }

      case '9':
        close(locator, 'has no new balance record');
        break;

      default:
        warnings.push(`Unknown CODA record type "${type}" ignored (${locator})`);
    }
  }

  close(`record ${records.length}`, 'has no new balance record');

  if (statements.length === 0) {
    throw new BankStatementParseError('No CODA statements found');
  }

  return { format: 'coda', formatVersion, statements, warnings };
}

function codaDate(value: string, locator: string): string | undefined {
  if (value.trim() === '' || /^0+$/.test(value)) {
    return undefined;
  }

  return ddmmyyToIso(value, locator);
}

function openStatement(record: FixedWidthRecord, header: CodaHeader): CodaContext {
  const r = record.text;
  const locator = `record ${record.index}`;
  const structure = field(r, 2, 2);
  const account: ParsedAccountIdentifier = {};
  let currencyRaw: string;

  if (structure === '0') {
    const number = field(r, 6, 17).trim();

    account.accountNumber = number;
    account.iban = /^\d{12}$/.test(number) ? normalizeIban(ibanFromBban('BE', number)) : undefined;
    currencyRaw = field(r, 19, 21);
  } else if (structure === '2' || structure === '3') {
    const value = (structure === '2' ? field(r, 6, 36) : field(r, 6, 39)).trim();

    account.iban = normalizeIban(value);
    account.accountNumber = account.iban ? undefined : value;
    currencyRaw = field(r, 40, 42);
  } else {
    account.accountNumber = field(r, 6, 39).trim();
    currencyRaw = field(r, 40, 42);
  }

  if (header.bic) {
    account.bic = header.bic;
  }

  if (header.bankCode && !/^0+$/.test(header.bankCode)) {
    account.bankCode = header.bankCode;
  }

  const currency = normalizeCurrency(currencyRaw);

  if (!currency) {
    throw new BankStatementParseError(`Invalid currency "${currencyRaw}"`, locator);
  }

  const date = codaDate(field(r, 59, 64), locator) ?? header.creationDate;
  const openingBalance: ParsedBalance | undefined = date
    ? { amount: signed(impliedDecimal(field(r, 44, 58), 3), field(r, 43, 43) === '1'), currency, date }
    : undefined;

  return {
    firstIndex: record.index,
    movements: new Map(),
    statement: {
      kind: 'statement',
      account: compactObject(account),
      currency,
      statementId: field(r, 126, 128).trim() || undefined,
      sequenceNumber: field(r, 3, 5).trim() || undefined,
      openingBalance,
      transactions: [],
    },
  };
}

function applyMovementRecord(
  context: CodaContext,
  record: FixedWidthRecord,
  warnings: string[],
  budget: ParseBudget,
): void {
  const r = record.text;
  const locator = `record ${record.index}`;
  const subtype = field(r, 2, 2);
  const key = `${field(r, 3, 6)}/${field(r, 7, 10)}`;

  if (subtype === '1') {
    budget.addTransaction(locator);

    const commType = field(r, 62, 62);
    const communication = field(r, 63, 115);
    const structured = commType === '1';

    context.movements.set(key, {
      sequence: field(r, 3, 6),
      detail: field(r, 7, 10),
      firstIndex: record.index,
      records: [r],
      bankReference: field(r, 11, 31).trim() || undefined,
      negative: field(r, 32, 32) === '1',
      amount: impliedDecimal(field(r, 33, 47), 3),
      valueDate: codaDate(field(r, 48, 53), locator),
      entryDate: codaDate(field(r, 116, 121), locator),
      transactionCode: field(r, 54, 61),
      structured,
      structuredType: structured ? communication.slice(0, 3) : undefined,
      communication: structured ? communication.slice(3) : communication,
      information: [],
    });

    return;
  }

  const movement = context.movements.get(key);

  if (!movement) {
    warnings.push(`CODA record 2.${subtype} without matching 2.1 ignored (${locator})`);

    return;
  }

  movement.records.push(r);

  if (subtype === '2') {
    movement.communication += field(r, 11, 63);
    movement.endToEndId = field(r, 64, 98).trim() || undefined;
    movement.bic = normalizeBic(field(r, 99, 109));
    movement.rTransactionType = field(r, 113, 113).trim() || undefined;
    movement.returnReason = field(r, 114, 117).trim() || undefined;
  } else if (subtype === '3') {
    movement.counterpartyAccount = field(r, 11, 44).trim() || undefined;
    movement.counterpartyName = field(r, 48, 82);
    movement.communication += field(r, 83, 125);
  } else {
    warnings.push(`Unknown CODA record type "2${subtype}" ignored (${locator})`);
  }
}

function applyInformationRecord(context: CodaContext, record: FixedWidthRecord, warnings: string[]): void {
  const r = record.text;
  const locator = `record ${record.index}`;
  const subtype = field(r, 2, 2);
  const sequence = field(r, 3, 6);
  const movement = context.movements.get(`${sequence}/${field(r, 7, 10)}`) ?? context.movements.get(`${sequence}/0000`);

  if (!movement) {
    warnings.push(`CODA information record without matching movement ignored (${locator})`);

    return;
  }

  movement.records.push(r);

  if (subtype === '1') {
    movement.information.push(field(r, 40, 40) === '1' ? field(r, 44, 113) : field(r, 41, 113));
  } else if (subtype === '2') {
    movement.information.push(field(r, 11, 115));
  } else if (subtype === '3') {
    movement.information.push(field(r, 11, 100));
  } else {
    warnings.push(`Unknown CODA record type "3${subtype}" ignored (${locator})`);
  }
}

function movementDetail(movement: CodaMovement): ParsedTransactionDetail {
  const detail: ParsedTransactionDetail = {};
  let remittance = movement.communication;

  if (movement.structured && (movement.structuredType === '101' || movement.structuredType === '102')) {
    const ogm = movement.communication.slice(0, 12);

    if (isValidBelgianOgm(ogm)) {
      detail.structuredReferences = [{ type: 'BBA', reference: ogm }];
      remittance = `+++${ogm.slice(0, 3)}/${ogm.slice(3, 7)}/${ogm.slice(7)}+++ ${movement.communication.slice(12)}`;
    }
  }

  detail.remittance = [remittance, ...movement.information].join(' ');

  if (movement.endToEndId && movement.endToEndId.toUpperCase() !== 'NOTPROVIDED') {
    detail.endToEndId = movement.endToEndId;
  }

  if (movement.returnReason) {
    detail.returnReason = movement.returnReason;
  }

  const iban = normalizeIban(movement.counterpartyAccount);

  detail.counterparty = {
    name: movement.counterpartyName,
    iban,
    accountNumber: iban ? undefined : movement.counterpartyAccount,
    bic: movement.bic,
  };

  return finalizeDetail(detail);
}

function finalizeStatement(context: CodaContext, warnings: string[]): ParsedStatement {
  const { statement } = context;
  const currency = statement.currency ?? 'EUR';
  const fallbackDate = statement.closingBalance?.date ?? statement.openingBalance?.date;
  const groups = new Map<string, CodaMovement[]>();

  for (const movement of context.movements.values()) {
    const group = groups.get(movement.sequence) ?? [];

    group.push(movement);
    groups.set(movement.sequence, group);
  }

  for (const group of groups.values()) {
    const parent = group.find((m) => /^0+$/.test(m.detail));
    const children = group.filter((m) => m !== parent);

    if (!parent) {
      // Details without a globalisation record: book each one as its own movement.
      for (const movement of children) {
        statement.transactions.push(buildTransaction(movement, [], currency, fallbackDate, warnings));
      }

      continue;
    }

    statement.transactions.push(buildTransaction(parent, children, currency, fallbackDate, warnings));
  }

  fillPeriodFromTransactions(statement);
  checkBalanceContinuity(statement, `CODA statement at record ${context.firstIndex}`, warnings);

  return statement;
}

function buildTransaction(
  movement: CodaMovement,
  children: CodaMovement[],
  currency: string,
  fallbackDate: string | undefined,
  warnings: string[],
): ParsedTransaction {
  const locator = `record ${movement.firstIndex}`;
  const bookingDate = movement.entryDate ?? fallbackDate;

  if (!bookingDate) {
    throw new BankStatementParseError('Movement has no entry date', locator);
  }

  if (!movement.entryDate) {
    warnings.push(`Movement without entry date booked on the statement date (${locator})`);
  }

  const parentDetail = movementDetail(movement);
  const details =
    children.length > 0
      ? children.map((child) =>
          finalizeDetail({ ...movementDetail(child), amount: signed(child.amount, child.negative), currency }),
        )
      : [parentDetail];

  return {
    status: 'booked',
    bookingDate,
    valueDate: movement.valueDate,
    amount: signed(movement.amount, movement.negative),
    currency,
    isReversal: movement.rTransactionType !== undefined && movement.rTransactionType !== '0',
    bankTransactionCode: { national: movement.transactionCode },
    bookingText: children.length > 0 ? parentDetail.remittance : undefined,
    bankReference: movement.bankReference,
    entryReference: movement.sequence,
    isBatch: children.length > 0,
    batchCount: children.length > 0 ? children.length : undefined,
    details,
    locator,
    raw: rawText([...movement.records, ...children.flatMap((child) => child.records)]),
  };
}
