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
import { ddmmyyToIso, impliedDecimal, normalizeCurrency, normalizeDecimal, normalizeIban } from '../bank-parse.utils';

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
 * Italian CBI "Rendicontazione movimenti di conto corrente" (flow RH-EF, manual CBI-RND-001), 120-character records.
 * Positions are 1-based and inclusive. The official CBI manuals are only available to CBI members; the positions
 * below follow the open Kaitai description of the flow (github.com/simonmx1/CBI_Parser, src/parse/cbi.ksy) and are
 * consistent with real bank output (63 `YYY` with an 8-digit order date, `ID1`/`RI1` blocks).
 *
 *  RH – header: 1 blank · 2-3 `RH` · 4-8 sender (ABI) · 9-13 receiver (SIA code) · 14-19 creation date DDMMYY
 *       20-39 file name · 40-115 filler · 116-120 not available
 *  61 – opening balance: 2-3 `61` · 4-10 progressive number · 11-23 filler · 24-28 original ABI (merged bank)
 *       29-33 reason (fixed `93001` / `93011`) · 34-49 account description · 50-51 account type · 52 CIN
 *       53-57 ABI · 58-62 CAB · 63-74 account number (12) · 75-77 currency · 78-83 booking date DDMMYY · 84 sign C/D
 *       85-99 opening balance (15) · 100-101 IBAN country (IT/SM) · 102-103 IBAN check digits · 104-120 filler
 *       (IBAN = country + check digits + CIN + ABI + CAB + account, used only when its check digits are valid)
 *  62 – movement: 4-10 progressive number · 11-13 movement number · 14-19 value date DDMMYY
 *       20-25 booking date DDMMYY · 26 sign C/D · 27-41 amount (15) · 42-43 CBI reason code (causale ABI/CBI)
 *       44-45 bank-internal reason · 46-61 cheque number · 62-77 bank reference · 78-86 customer reference type
 *       87-120 description (34)
 *  63 – additional information for the movement with the same progressive + movement number:
 *       4-10 progressive · 11-13 movement number · 14-120 information (107). Structured variants (14-16 flag):
 *       `KKK` cash-pooling account (17-39) · `YYY` ordering party (17-24 order date DDMMYYYY, 25-40 tax code,
 *       41-80 name, 81-120 town) · `YY2` ordering party (17-66 address, 67-100 IBAN)
 *       `ZZ1` foreign transfer amounts / exchange rate · `ZZ2` ordering party in full (17-120)
 *       `ZZ3` beneficiary (17-66) and payment reason (67-120) · `ID1` identifiers (17-51 message id,
 *       52-86 end-to-end id) · `RI1` reconciliation information (17-120) · `RI2` continuation (17-52);
 *       anything else is free text. IBANs and CRO/TRN references found anywhere in 63 texts are mapped as well.
 *  64 – closing balance: 4-10 progressive · 11-13 currency · 14-19 booking date DDMMYY · 20 sign C/D
 *       21-35 ledger balance (15) · 36 sign · 37-51 cleared ("liquido") balance (15)
 *  65 – future available balances: 4-10 progressive · up to five groups of date DDMMYY (6), sign (1),
 *       balance (15) starting at 11; only the first (11-16 date, 17 sign, 18-32 balance) is read.
 *  EF – trailer: like RH, plus 43-49 number of account reports and 80-86 number of records.
 *
 * Amounts: 15 characters, either with a decimal comma (`000000001234,56`) or 2 implied decimals.
 */

const RECORD_LENGTH = 120;
/** Linear: bounded character classes, no nested quantifiers. */
const IBAN_IN_TEXT = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const CRO_TRN = /\b(?:CRO|TRN)[\s:.]{0,3}([A-Z0-9]{11,35})\b/i;

interface CbiMovement {
  transaction: ParsedTransaction;
  records: string[];
  description: string;
  information: string[];
  remittance: string[];
  counterparty: ParsedCounterparty;
  detail: ParsedTransactionDetail;
}

interface CbiContext {
  statement: ParsedStatement;
  firstIndex: number;
  movements: Map<string, CbiMovement>;
}

export function cbiAmount(value: string, locator?: string): string {
  const trimmed = value.trim();

  if (trimmed.includes(',')) {
    try {
      return normalizeDecimal(trimmed, ',');
    } catch {
      throw new BankStatementParseError(`Invalid CBI amount "${value}"`, locator);
    }
  }

  return impliedDecimal(trimmed, 2);
}

export function parseCbiRh(text: string, limits: BankParseLimits = DEFAULT_BANK_PARSE_LIMITS): ParsedStatementFile {
  const records = splitFixedWidthRecords(text, RECORD_LENGTH);
  const budget = new ParseBudget(limits);
  const warnings: string[] = [];
  const statements: ParsedStatement[] = [];
  let context: CbiContext | undefined;

  if (records.length === 0 || !/^ ?(RH|61)/.test(records[0].text)) {
    throw new BankStatementParseError('Not a CBI RH file', 'record 1');
  }

  // An account report ends with 64 (+ optional 65s); it is closed lazily on the next RH/61/EF so 65s still attach.
  const close = (): void => {
    if (!context) {
      return;
    }

    if (!context.statement.closingBalance) {
      warnings.push(`Account report at record ${context.firstIndex} has no closing balance record 64`);
    }

    for (const movement of context.movements.values()) {
      finalizeMovement(movement, context.statement.account.iban);
    }

    fillPeriodFromTransactions(context.statement);
    checkBalanceContinuity(context.statement, `CBI account report at record ${context.firstIndex}`, warnings);
    statements.push(context.statement);
    context = undefined;
  };

  for (const record of records) {
    const r = record.text;
    const locator = `record ${record.index}`;
    const code = field(r, 2, 3);

    switch (code) {
      case 'RH':
        close();
        break;

      case '61':
        close();
        budget.addStatement(locator);
        context = openAccount(record);
        break;

      case '62': {
        if (!context) {
          throw new BankStatementParseError('Movement outside of an account report', locator);
        }

        budget.addTransaction(locator);

        const movement = parseMovement(record, context.statement);

        context.movements.set(field(r, 11, 13), movement);
        context.statement.transactions.push(movement.transaction);
        break;
      }

      case '63': {
        const movement = context?.movements.get(field(r, 11, 13));

        if (!movement) {
          warnings.push(`Record 63 without matching movement ignored (${locator})`);
          break;
        }

        applyInformation(movement, r);
        break;
      }

      case '64': {
        if (!context) {
          warnings.push(`Closing balance without opening balance ignored (${locator})`);
          break;
        }

        const currency = normalizeCurrency(field(r, 11, 13), context.statement.currency) ?? 'EUR';
        const date = ddmmyyToIso(field(r, 14, 19), locator);

        context.statement.closingBalance = {
          amount: signed(cbiAmount(field(r, 21, 35), locator), field(r, 20, 20) === 'D'),
          currency,
          date,
        };
        context.statement.periodTo = date;
        break;
      }

      case '65': {
        const statement = context?.statement ?? statements[statements.length - 1];

        if (!statement || statement.availableBalance) {
          break;
        }

        statement.availableBalance = {
          amount: signed(cbiAmount(field(r, 18, 32), locator), field(r, 17, 17) === 'D'),
          currency: statement.currency ?? 'EUR',
          date: ddmmyyToIso(field(r, 11, 16), locator),
        };
        break;
      }

      case 'EF':
        close();
        break;

      default:
        warnings.push(`Unknown CBI record type "${code.trim()}" ignored (${locator})`);
    }
  }

  close();

  return { format: 'cbi-rh', statements, warnings };
}

function openAccount(record: FixedWidthRecord): CbiContext {
  const r = record.text;
  const locator = `record ${record.index}`;
  const abi = field(r, 53, 57).trim();
  const cab = field(r, 58, 62).trim();
  const account = field(r, 63, 74).trim();
  const currency = normalizeCurrency(field(r, 75, 77));

  if (!currency) {
    throw new BankStatementParseError(`Invalid currency "${field(r, 75, 77)}"`, locator);
  }

  const ibanPrefix = `${field(r, 100, 101)}${field(r, 102, 103)}`;
  const ibanCandidate = `${ibanPrefix}${field(r, 52, 52)}${field(r, 53, 57)}${field(r, 58, 62)}${field(r, 63, 74)}`;
  const iban = /^[A-Z]{2}\d{2}$/.test(ibanPrefix) ? normalizeIban(ibanCandidate) : undefined;
  const accountId: ParsedAccountIdentifier = compactObject({
    iban,
    accountNumber: iban ? undefined : [abi, cab, account].join('/'),
    bankCode: abi || undefined,
  });
  const date = ddmmyyToIso(field(r, 78, 83), locator);
  const openingBalance: ParsedBalance = {
    amount: signed(cbiAmount(field(r, 85, 99), locator), field(r, 84, 84) === 'D'),
    currency,
    date,
  };

  return {
    firstIndex: record.index,
    movements: new Map(),
    statement: {
      kind: 'statement',
      account: accountId,
      currency,
      statementId: field(r, 4, 10).trim() || undefined,
      periodFrom: date,
      openingBalance,
      transactions: [],
    },
  };
}

function parseMovement(record: FixedWidthRecord, statement: ParsedStatement): CbiMovement {
  const r = record.text;
  const locator = `record ${record.index}`;
  const valueRaw = field(r, 14, 19);
  const sign = field(r, 26, 26);

  if (sign !== 'C' && sign !== 'D') {
    throw new BankStatementParseError(`Invalid sign "${sign}"`, locator);
  }

  const transaction: ParsedTransaction = {
    status: 'booked',
    bookingDate: ddmmyyToIso(field(r, 20, 25), locator),
    valueDate: /^0*$/.test(valueRaw.trim()) ? undefined : ddmmyyToIso(valueRaw, locator),
    amount: signed(cbiAmount(field(r, 27, 41), locator), sign === 'D'),
    currency: statement.currency ?? 'EUR',
    isReversal: false,
    bankTransactionCode: {
      national: field(r, 42, 43).trim() || undefined,
      proprietary: field(r, 44, 45).trim() || undefined,
    },
    bookingText: field(r, 87, 120).trim() || undefined,
    bankReference: field(r, 62, 77).trim() || undefined,
    entryReference: field(r, 11, 13).trim() || undefined,
    isBatch: false,
    details: [],
    locator,
  };

  return {
    transaction,
    records: [r],
    description: field(r, 87, 120),
    information: [],
    remittance: [],
    counterparty: {},
    detail: {},
  };
}

function applyInformation(movement: CbiMovement, r: string): void {
  const flag = field(r, 14, 16);
  const outgoing = movement.transaction.amount.startsWith('-');

  movement.records.push(r);

  switch (flag) {
    case 'YYY':
      movement.counterparty.name = field(r, 41, 80);
      break;
    case 'YY2':
      movement.information.push(field(r, 67, 100));
      break;
    case 'KKK':
    case 'ZZ1':
      // Cash-pooling account / original amounts and exchange rate: kept in `raw` only.
      break;
    case 'ZZ2':
      if (!outgoing && !movement.counterparty.name?.trim()) {
        movement.counterparty.name = field(r, 17, 120);
      }

      movement.information.push(field(r, 17, 120));
      break;
    case 'ZZ3':
      if (outgoing && !movement.counterparty.name?.trim()) {
        movement.counterparty.name = field(r, 17, 66);
      }

      movement.remittance.push(field(r, 67, 120));
      break;
    case 'ID1':
      movement.detail.messageId = field(r, 17, 51).trim() || undefined;
      movement.detail.endToEndId = field(r, 52, 86).trim() || undefined;
      break;
    case 'RI1':
      movement.remittance.push(field(r, 17, 120));
      break;
    case 'RI2':
      movement.remittance.push(field(r, 17, 52));
      break;
    default:
      movement.remittance.push(field(r, 14, 120));
  }
}

function finalizeMovement(movement: CbiMovement, ownIban: string | undefined): void {
  const texts = [...movement.information, ...movement.remittance];

  for (const value of texts) {
    for (const match of value.toUpperCase().matchAll(IBAN_IN_TEXT)) {
      const iban = normalizeIban(match[0]);

      if (iban && !iban.startsWith('RF') && iban !== ownIban && !movement.counterparty.iban) {
        movement.counterparty.iban = iban;
      }
    }

    const reference = CRO_TRN.exec(value);

    if (reference && !movement.detail.instructionId) {
      movement.detail.instructionId = reference[1];
    }
  }

  const remittance = movement.remittance.length > 0 ? movement.remittance.join('') : movement.description;

  movement.transaction.details = [
    finalizeDetail({ ...movement.detail, remittance, counterparty: movement.counterparty }),
  ];
  movement.transaction.raw = rawText(movement.records);
}
