import {
  BankStatementParseError,
  DEFAULT_BANK_PARSE_LIMITS,
  type BankParseLimits,
  type BankStatementFormat,
  type BankStatementKind,
  type BankTransactionStatus,
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
  isValidQrReference,
  isValidRfReference,
  isoDate,
  negateDecimal,
  normalizeBic,
  normalizeCurrency,
  normalizeDecimal,
  normalizeIban,
  sumDecimals,
  truncate,
} from '../bank-parse.utils';

import { mergeStructuredReferences, pruneUndefined } from './parser-helpers';
import { attributeOf, child, children, parseXml, textAt, type XmlElement } from './safe-xml';
import { parseSepaPurpose } from './sepa-purpose';

/**
 * ISO 20022 cash management parser: camt.052 (intraday account report), camt.053 (statement) and camt.054
 * (debit/credit notification), any message version 02–13.
 */

const CAMT_NAMESPACE_RE = /^urn:iso:std:iso:20022:tech:xsd:camt\.(05[234])\.001\.(\d{2})$/;
const CAMT_ANY_NAMESPACE_RE = /^urn:iso:std:iso:20022:tech:xsd:camt\./;
const MAX_TEXT = 4000;

interface CamtMessageType {
  format: BankStatementFormat;
  message: string;
  statement: string;
  kind: BankStatementKind;
}

const CAMT_MESSAGES: Record<string, CamtMessageType> = {
  '052': { format: 'camt.052', message: 'BkToCstmrAcctRpt', statement: 'Rpt', kind: 'intraday' },
  '053': { format: 'camt.053', message: 'BkToCstmrStmt', statement: 'Stmt', kind: 'statement' },
  '054': { format: 'camt.054', message: 'BkToCstmrDbtCdtNtfctn', statement: 'Ntfctn', kind: 'notification' },
};

type Indicator = 'CRDT' | 'DBIT';

interface ParseContext {
  type: CamtMessageType;
  limits: BankParseLimits;
  warnings: string[];
  transactionCount: number;
  detailCount: number;
  creationDate?: string;
}

/** Parses a camt.052/053/054 XML document. */
export function parseCamt(text: string, limits: BankParseLimits = DEFAULT_BANK_PARSE_LIMITS): ParsedStatementFile {
  const root = parseXml(text);
  const located = locateCamtElement(root);

  if (!located) {
    throw new BankStatementParseError(
      hasAnyCamtNamespace(root)
        ? 'Unsupported camt message type or version'
        : 'Not an ISO 20022 camt.052/053/054 document',
    );
  }

  const { element, typeCode, version } = located;
  const type = CAMT_MESSAGES[typeCode];
  const versionNumber = Number(version);

  if (versionNumber < 2 || versionNumber > 13) {
    throw new BankStatementParseError(`Unsupported camt.${typeCode} version 001.${version}`);
  }

  const message = element.name === type.message ? element : child(element, type.message);

  if (!message) {
    throw new BankStatementParseError(`camt.${typeCode} document has no ${type.message} element`);
  }

  const ctx: ParseContext = {
    type,
    limits,
    warnings: [],
    transactionCount: 0,
    detailCount: 0,
    creationDate: xmlDate(textAt(message, 'GrpHdr', 'CreDtTm')),
  };
  const statementElements = children(message, type.statement);

  if (statementElements.length > limits.maxStatements) {
    throw new BankStatementParseError(`Too many statements (${statementElements.length})`);
  }

  const statements = statementElements.map((el, idx) => parseStatement(el, idx + 1, ctx));

  return {
    format: type.format,
    formatVersion: `001.${version}`,
    statements,
    warnings: ctx.warnings,
  };
}

function locateCamtElement(root: XmlElement): { element: XmlElement; typeCode: string; version: string } | undefined {
  // Breadth-first over the first levels: tolerates envelopes (e.g. SWIFT DataPDU / AppHdr wrappers).
  const queue: Array<{ el: XmlElement; depth: number }> = [{ el: root, depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && visited < 1000) {
    const next = queue.shift();

    if (!next) {
      break;
    }

    visited += 1;

    const match = CAMT_NAMESPACE_RE.exec(next.el.namespace);

    if (match) {
      return { element: next.el, typeCode: match[1], version: match[2] };
    }

    if (next.depth < 4) {
      for (const c of next.el.children) {
        queue.push({ el: c, depth: next.depth + 1 });
      }
    }
  }

  return undefined;
}

function hasAnyCamtNamespace(root: XmlElement): boolean {
  return (
    CAMT_ANY_NAMESPACE_RE.test(root.namespace) || root.children.some((c) => CAMT_ANY_NAMESPACE_RE.test(c.namespace))
  );
}

function parseStatement(el: XmlElement, index: number, ctx: ParseContext): ParsedStatement {
  const label = `${ctx.type.statement}[${index}]`;
  const acct = child(el, 'Acct');
  const account = parseAccount(acct);
  const accountCurrency = normalizeCurrency(textAt(acct, 'Ccy'));
  const periodFrom = xmlDate(textAt(el, 'FrToDt', 'FrDtTm'));
  const periodTo = xmlDate(textAt(el, 'FrToDt', 'ToDtTm'));
  const statementDate = periodTo ?? xmlDate(textAt(el, 'CreDtTm')) ?? ctx.creationDate;
  const balances = parseBalances(el, accountCurrency, statementDate, ctx, label);
  const currency =
    accountCurrency ??
    balances.opening?.currency ??
    balances.closing?.currency ??
    normalizeCurrency(attributeOf(child(el, 'Ntry', 'Amt'), 'Ccy'));
  const transactions: ParsedTransaction[] = [];

  children(el, 'Ntry').forEach((ntry, idx) => {
    ctx.transactionCount += 1;

    if (ctx.transactionCount > ctx.limits.maxTransactions) {
      throw new BankStatementParseError('Too many transactions in file', label);
    }

    transactions.push(parseEntry(ntry, `${label}/Ntry[${idx + 1}]`, currency, statementDate, ctx));
  });

  if (ctx.type.kind === 'statement') {
    checkBalanceContinuity(balances.opening, balances.closing, transactions, label, ctx);
  }

  const statement: ParsedStatement = {
    kind: ctx.type.kind,
    account,
    transactions,
  };

  assignDefined(statement, {
    currency,
    statementId: textAt(el, 'Id'),
    sequenceNumber: textAt(el, 'ElctrncSeqNb') ?? textAt(el, 'LglSeqNb'),
    periodFrom,
    periodTo,
    openingBalance: balances.opening,
    closingBalance: balances.closing,
    availableBalance: balances.available,
  });

  return statement;
}

function parseAccount(acct: XmlElement | undefined): ParsedAccountIdentifier {
  const rawIban = textAt(acct, 'Id', 'IBAN');
  const iban = normalizeIban(rawIban);
  const other = textAt(acct, 'Id', 'Othr', 'Id');
  const institution = child(acct, 'Svcr', 'FinInstnId');

  return (
    pruneUndefined<ParsedAccountIdentifier>({
      iban,
      accountNumber: iban ? undefined : (rawIban?.replace(/\s/g, '') ?? other),
      bankCode: textAt(institution, 'ClrSysMmbId', 'MmbId'),
      bic: normalizeBic(textAt(institution, 'BIC') ?? textAt(institution, 'BICFI')),
    }) ?? {}
  );
}

interface StatementBalances {
  opening?: ParsedBalance;
  closing?: ParsedBalance;
  available?: ParsedBalance;
}

function parseBalances(
  el: XmlElement,
  accountCurrency: string | undefined,
  fallbackDate: string | undefined,
  ctx: ParseContext,
  label: string,
): StatementBalances {
  const byCode = new Map<string, ParsedBalance[]>();

  children(el, 'Bal').forEach((bal, idx) => {
    const code = (textAt(bal, 'Tp', 'CdOrPrtry', 'Cd') ?? textAt(bal, 'Tp', 'CdOrPrtry', 'Prtry'))?.toUpperCase();
    const amountEl = child(bal, 'Amt');

    if (!code || !amountEl) {
      return;
    }

    const currency = normalizeCurrency(attributeOf(amountEl, 'Ccy'), accountCurrency);
    const date = xmlDate(textAt(bal, 'Dt', 'Dt') ?? textAt(bal, 'Dt', 'DtTm')) ?? fallbackDate;

    if (!currency || !date) {
      ctx.warnings.push(`${label}/Bal[${idx + 1}]: balance ${code} without currency or date ignored`);

      return;
    }

    const balance: ParsedBalance = {
      amount: signedAmount(amountEl, textAt(bal, 'CdtDbtInd'), `${label}/Bal[${idx + 1}]`),
      currency,
      date,
    };
    const list = byCode.get(code) ?? [];

    list.push(balance);
    byCode.set(code, list);
  });

  const first = (code: string): ParsedBalance | undefined => byCode.get(code)?.[0];
  const last = (code: string): ParsedBalance | undefined => {
    const list = byCode.get(code);

    return list ? list[list.length - 1] : undefined;
  };
  const result: StatementBalances = {
    opening: first('OPBD') ?? first('PRCD'),
    closing: last('CLBD'),
    available: last('CLAV') ?? last('ITAV'),
  };
  const intraday = byCode.get('ITBD');

  if (intraday && intraday.length > 0) {
    if (!result.opening && !result.closing && intraday.length > 1) {
      result.opening = intraday[0];
    }

    if (!result.closing) {
      result.closing = intraday[intraday.length - 1];
    }
  }

  return result;
}

function parseEntry(
  ntry: XmlElement,
  locator: string,
  statementCurrency: string | undefined,
  statementDate: string | undefined,
  ctx: ParseContext,
): ParsedTransaction {
  const amountEl = child(ntry, 'Amt');

  if (!amountEl) {
    throw new BankStatementParseError('Entry without amount', locator);
  }

  const indicator = parseIndicator(textAt(ntry, 'CdtDbtInd'), locator);
  const amount = signedAmount(amountEl, indicator, locator);
  const currency = normalizeCurrency(attributeOf(amountEl, 'Ccy'), statementCurrency);

  if (!currency) {
    throw new BankStatementParseError('Entry without currency', locator);
  }

  const reversalFlag = textAt(ntry, 'RvslInd')?.toLowerCase();
  const valueDate = xmlDate(textAt(ntry, 'ValDt', 'Dt') ?? textAt(ntry, 'ValDt', 'DtTm'));
  const bookingDate =
    xmlDate(textAt(ntry, 'BookgDt', 'Dt') ?? textAt(ntry, 'BookgDt', 'DtTm')) ?? valueDate ?? statementDate;

  if (!bookingDate) {
    throw new BankStatementParseError('Entry without booking or value date', locator);
  }

  const entryDetails = children(ntry, 'NtryDtls');
  const txDetails = entryDetails.flatMap((d) => children(d, 'TxDtls'));
  const batchCountText = entryDetails.map((d) => textAt(d, 'Btch', 'NbOfTxs')).find((v) => v !== undefined);
  const batchCount = batchCountText && /^\d{1,9}$/.test(batchCountText) ? Number(batchCountText) : undefined;
  const isBatch = (batchCount ?? 0) > 1 || txDetails.length > 1;
  const bookingText = truncate(
    cleanText(
      children(ntry, 'AddtlNtryInf')
        .map((e) => e.text)
        .join(' '),
    ),
    MAX_TEXT,
  );

  ctx.detailCount += txDetails.length;

  if (ctx.detailCount > ctx.limits.maxTransactions) {
    throw new BankStatementParseError('Too many transaction details in file', locator);
  }

  const entry: EntryContext = { amount, currency, indicator, multiple: txDetails.length > 1 };
  let details = txDetails.map((tx) => parseTransactionDetails(tx, entry));

  if (details.length === 0) {
    const fallback = bookingText ? detailFromFreeText(bookingText, indicator) : undefined;

    details = fallback ? [fallback] : [];
  }

  const transaction: ParsedTransaction = {
    status: mapStatus(textAt(ntry, 'Sts', 'Cd') ?? textAt(ntry, 'Sts') ?? textAt(ntry, 'Sts', 'Prtry'), locator, ctx),
    bookingDate,
    amount,
    currency,
    isReversal: reversalFlag === 'true' || reversalFlag === '1',
    isBatch,
    details,
    locator,
  };
  const singleTxBankRef = txDetails.length === 1 ? textAt(txDetails[0], 'Refs', 'AcctSvcrRef') : undefined;

  assignDefined(transaction, {
    valueDate,
    bankTransactionCode: parseBankTransactionCode(child(ntry, 'BkTxCd')),
    bookingText:
      bookingText ??
      (txDetails.length === 1 ? truncate(cleanText(textAt(txDetails[0], 'AddtlTxInf')), MAX_TEXT) : undefined),
    bankReference: textAt(ntry, 'AcctSvcrRef') ?? singleTxBankRef,
    entryReference: textAt(ntry, 'NtryRef'),
    batchCount: batchCount ?? (txDetails.length > 1 ? txDetails.length : undefined),
  });

  return transaction;
}

interface EntryContext {
  amount: string;
  currency: string;
  indicator: Indicator;
  multiple: boolean;
}

function parseTransactionDetails(tx: XmlElement, entry: EntryContext): ParsedTransactionDetail {
  const indicatorText = textAt(tx, 'CdtDbtInd');
  const indicator: Indicator = indicatorText === 'CRDT' || indicatorText === 'DBIT' ? indicatorText : entry.indicator;
  const credit = indicator === 'CRDT';
  const detail: ParsedTransactionDetail = {};
  // Amounts
  const txAmountEl = child(tx, 'Amt') ?? child(tx, 'AmtDtls', 'TxAmt', 'Amt');

  if (txAmountEl) {
    const amount = signedAmount(txAmountEl, indicator);
    const currency = normalizeCurrency(attributeOf(txAmountEl, 'Ccy'), entry.currency) ?? entry.currency;

    if (entry.multiple || currency !== entry.currency || compareDecimals(amount, entry.amount) !== 0) {
      detail.amount = amount;
      detail.currency = currency;
    }
  }

  const instructed = child(tx, 'AmtDtls', 'InstdAmt');
  const instructedAmountEl = child(instructed, 'Amt');
  const instructedCurrency = normalizeCurrency(attributeOf(instructedAmountEl, 'Ccy'));

  if (instructedAmountEl && instructedCurrency && instructedCurrency !== entry.currency) {
    detail.originalAmount = signedAmount(instructedAmountEl, indicator);
    detail.originalCurrency = instructedCurrency;
  }

  const rate =
    textAt(instructed, 'CcyXchg', 'XchgRate') ??
    textAt(tx, 'AmtDtls', 'TxAmt', 'CcyXchg', 'XchgRate') ??
    textAt(tx, 'AmtDtls', 'CntrValAmt', 'CcyXchg', 'XchgRate');

  if (rate && /^\d{1,18}(\.\d{1,18})?$/.test(rate)) {
    detail.exchangeRate = rate;
  }

  // References
  const refs = child(tx, 'Refs');
  const endToEndId = textAt(refs, 'EndToEndId');

  assignDefined(detail, {
    messageId: textAt(refs, 'MsgId'),
    paymentInformationId: textAt(refs, 'PmtInfId'),
    instructionId: textAt(refs, 'InstrId'),
    endToEndId: endToEndId && endToEndId.toUpperCase() !== 'NOTPROVIDED' ? endToEndId : undefined,
    uetr: textAt(refs, 'UETR'),
    mandateId: textAt(refs, 'MndtId'),
  });

  // Parties
  const parties = child(tx, 'RltdPties');
  const creditorParty = child(parties, 'Cdtr');
  const account = child(parties, credit ? 'DbtrAcct' : 'CdtrAcct');
  const rawIban = textAt(account, 'Id', 'IBAN');
  const counterparty: ParsedCounterparty = {};

  assignDefined(counterparty, {
    name: truncate(cleanText(partyName(child(parties, credit ? 'Dbtr' : 'Cdtr'))), 500),
    iban: normalizeIban(rawIban),
    accountNumber: normalizeIban(rawIban)
      ? undefined
      : (rawIban?.replace(/\s/g, '') ?? textAt(account, 'Id', 'Othr', 'Id')),
    bic: agentBic(child(tx, 'RltdAgts', credit ? 'DbtrAgt' : 'CdtrAgt')),
    ultimateName: truncate(cleanText(partyName(child(parties, credit ? 'UltmtDbtr' : 'UltmtCdtr'))), 500),
  });

  const creditorId =
    textAt(tx, 'CdtrSchmeId', 'Id', 'PrvtId', 'Othr', 'Id') ??
    textAt(parties, 'CdtrSchmeId', 'Id', 'PrvtId', 'Othr', 'Id') ??
    sepaSchemeId(child(creditorParty, 'Id') ?? child(creditorParty, 'Pty', 'Id'));

  if (creditorId) {
    detail.creditorId = creditorId;
  }

  // Remittance
  const remittanceInfo = children(tx, 'RmtInf');
  const unstructured = remittanceInfo.flatMap((r) => children(r, 'Ustrd')).map((e) => e.text);
  const explicitRefs: ParsedStructuredReference[] = [];
  const additional: string[] = [];

  for (const strd of remittanceInfo.flatMap((r) => children(r, 'Strd'))) {
    const ref = parseCreditorReference(child(strd, 'CdtrRefInf'));

    if (ref) {
      explicitRefs.push(ref);
    }

    for (const extra of children(strd, 'AddtlRmtInf')) {
      additional.push(extra.text);
    }
  }

  let remittance = truncate(cleanText([...unstructured, ...additional].join(' ')), MAX_TEXT);

  if (remittance && !detail.endToEndId) {
    const sepa = parseSepaPurpose(remittance);

    if (sepa) {
      remittance = sepa.remittance;
      assignIfMissing(detail, 'endToEndId', sepa.endToEndId);
      assignIfMissing(detail, 'mandateId', sepa.mandateId);
      assignIfMissing(detail, 'creditorId', sepa.creditorId);
      assignIfMissing(detail, 'paymentInformationId', sepa.customerReference);
      assignIfMissing(counterparty, 'ultimateName', credit ? sepa.ultimateDebtor : sepa.ultimateCreditor);
      assignIfMissing(counterparty, 'iban', sepa.iban);
      assignIfMissing(counterparty, 'bic', sepa.bic);
    }
  }

  if (remittance) {
    detail.remittance = remittance;
  }

  const structuredReferences = mergeStructuredReferences(explicitRefs, remittance);

  if (structuredReferences) {
    detail.structuredReferences = structuredReferences;
  }

  if (Object.keys(counterparty).length > 0) {
    detail.counterparty = counterparty;
  }

  const returnReason = textAt(tx, 'RtrInf', 'Rsn', 'Cd') ?? textAt(tx, 'RtrInf', 'Rsn', 'Prtry');

  if (returnReason) {
    detail.returnReason = returnReason;
  }

  return detail;
}

function detailFromFreeText(text: string, indicator: Indicator): ParsedTransactionDetail | undefined {
  const sepa = parseSepaPurpose(text);
  const detail: ParsedTransactionDetail = {};

  if (sepa) {
    assignDefined(detail, {
      endToEndId: sepa.endToEndId,
      mandateId: sepa.mandateId,
      creditorId: sepa.creditorId,
      paymentInformationId: sepa.customerReference,
      remittance: sepa.remittance,
    });

    const counterparty = pruneUndefined<ParsedCounterparty>({
      iban: sepa.iban,
      bic: sepa.bic,
      ultimateName: indicator === 'CRDT' ? sepa.ultimateDebtor : sepa.ultimateCreditor,
    });

    if (counterparty) {
      detail.counterparty = counterparty;
    }
  } else {
    detail.remittance = text;
  }

  const refs = mergeStructuredReferences([], detail.remittance);

  if (refs) {
    detail.structuredReferences = refs;
  }

  return Object.keys(detail).length > 0 ? detail : undefined;
}

function parseCreditorReference(info: XmlElement | undefined): ParsedStructuredReference | undefined {
  const reference = textAt(info, 'Ref')?.replace(/\s/g, '');

  if (!reference) {
    return undefined;
  }

  const code = textAt(info, 'Tp', 'CdOrPrtry', 'Cd')?.toUpperCase();
  const proprietary = textAt(info, 'Tp', 'CdOrPrtry', 'Prtry')?.toUpperCase();
  const issuer = textAt(info, 'Tp', 'Issr');
  let type: ParsedStructuredReference['type'];

  if (proprietary === 'QRR' || (!code && isValidQrReference(reference))) {
    type = 'QRR';
  } else if (code === 'SCOR' || proprietary === 'SCOR' || isValidRfReference(reference)) {
    type = 'SCOR';
  } else {
    type = 'OTHER';
  }

  return issuer ? { type, reference, issuer } : { type, reference };
}

function partyName(party: XmlElement | undefined): string | undefined {
  return textAt(party, 'Nm') ?? textAt(party, 'Pty', 'Nm');
}

function agentBic(agent: XmlElement | undefined): string | undefined {
  return normalizeBic(textAt(agent, 'FinInstnId', 'BIC') ?? textAt(agent, 'FinInstnId', 'BICFI'));
}

/** Creditor identifier stored as `Id/PrvtId/Othr` with scheme name `SEPA` (German DK camt). */
function sepaSchemeId(id: XmlElement | undefined): string | undefined {
  for (const other of children(child(id, 'PrvtId'), 'Othr')) {
    if (textAt(other, 'SchmeNm', 'Prtry')?.toUpperCase() === 'SEPA') {
      return textAt(other, 'Id');
    }
  }

  return undefined;
}

function parseBankTransactionCode(el: XmlElement | undefined): ParsedTransaction['bankTransactionCode'] {
  if (!el) {
    return undefined;
  }

  const proprietary = textAt(el, 'Prtry', 'Cd');
  let national: string | undefined;

  if (proprietary) {
    const parts = proprietary.split('+');

    if (parts.length >= 2 && /^\d{3}$/.test(parts[1])) {
      national = parts[1];
    } else if (/^\d{3}$/.test(proprietary)) {
      national = proprietary;
    }
  }

  return pruneUndefined({
    domain: textAt(el, 'Domn', 'Cd'),
    family: textAt(el, 'Domn', 'Fmly', 'Cd'),
    subFamily: textAt(el, 'Domn', 'Fmly', 'SubFmlyCd'),
    proprietary,
    national,
  });
}

function mapStatus(value: string | undefined, locator: string, ctx: ParseContext): BankTransactionStatus {
  switch (value?.toUpperCase()) {
    case undefined:
    case 'BOOK':
      return 'booked';
    case 'PDNG':
    case 'FUTR':
      return 'pending';
    case 'INFO':
      return 'info';
    default:
      ctx.warnings.push(`${locator}: unknown entry status "${truncate(value, 20)}" treated as booked`);

      return 'booked';
  }
}

function parseIndicator(value: string | undefined, locator: string): Indicator {
  if (value === 'CRDT' || value === 'DBIT') {
    return value;
  }

  throw new BankStatementParseError(`Invalid credit/debit indicator "${truncate(value ?? '', 10)}"`, locator);
}

function signedAmount(amountEl: XmlElement, indicator: string | undefined, locator?: string): string {
  const raw = amountEl.text.trim();

  if (!/^-?\d{1,18}(\.\d{1,8})?$/.test(raw)) {
    throw new BankStatementParseError(`Invalid amount "${truncate(raw, 30)}"`, locator);
  }

  const amount = normalizeDecimal(raw, '.');

  return indicator === 'DBIT' ? negateDecimal(amount) : amount;
}

/** `YYYY-MM-DD` or `YYYY-MM-DDThh:mm:ss…` → validated ISO date (date part only). */
function xmlDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

  if (!match) {
    throw new BankStatementParseError(`Invalid date "${truncate(value, 30)}"`);
  }

  return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function checkBalanceContinuity(
  opening: ParsedBalance | undefined,
  closing: ParsedBalance | undefined,
  transactions: ParsedTransaction[],
  label: string,
  ctx: ParseContext,
): void {
  if (!opening || !closing || opening.currency !== closing.currency) {
    return;
  }

  const booked = transactions.filter((t) => t.status === 'booked' && t.currency === opening.currency);
  const computed = sumDecimals([opening.amount, ...booked.map((t) => t.amount)]);

  if (compareDecimals(computed, closing.amount) !== 0) {
    ctx.warnings.push(
      `${label}: opening balance ${opening.amount} plus booked entries gives ${computed}, but closing balance is ${closing.amount}`,
    );
  }
}

function assignDefined<T extends object>(target: T, values: Partial<T>): void {
  for (const key of Object.keys(values) as Array<keyof T>) {
    const value = values[key];

    if (value !== undefined) {
      target[key] = value as T[keyof T];
    }
  }
}

function assignIfMissing<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (target[key] === undefined && value !== undefined) {
    target[key] = value;
  }
}
