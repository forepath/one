import {
  BankStatementParseError,
  DEFAULT_BANK_PARSE_LIMITS,
  type BankParseLimits,
  type ParsedAccountIdentifier,
  type ParsedBalance,
  type ParsedStatement,
  type ParsedStatementFile,
  type ParsedTransaction,
} from '../bank-import.types';
import { cleanText, isoDate, normalizeBic, normalizeCurrency, normalizeIban } from '../bank-parse.utils';

import {
  ParseBudget,
  checkBalanceContinuity,
  compactObject,
  fillPeriodFromTransactions,
  finalizeDetail,
  parseLooseAmount,
  rawText,
} from './parser-common';

/**
 * OFX 1.x (SGML, leaf elements without closing tags) and OFX 2.x (XML) bank and credit card statements; QFX files
 * use the same structure. A small tolerant tokenizer builds an element tree — no DTD processing, `<!DOCTYPE` and
 * `<!ENTITY` are rejected, only the predefined XML entities and numeric character references are decoded.
 *
 * Mapped: STMTRS / CCSTMTRS (any number, anywhere in the tree) → statements; CURDEF; BANKACCTFROM (BANKID, BRANCHID,
 * ACCTID) / CCACCTFROM (ACCTID); BANKTRANLIST (DTSTART, DTEND, STMTTRN*); LEDGERBAL → closing balance; AVAILBAL →
 * available balance. STMTTRN: TRNTYPE → booking text / national code, DTPOSTED → booking date, DTUSER (else DTAVAIL)
 * → value date, TRNAMT (signed; decimal comma tolerated), FITID → bankReference, CHECKNUM (else REFNUM) →
 * entryReference, REFNUM → instructionId, NAME / PAYEE.NAME / EXTDNAME → counterparty, BANKACCTTO → counterparty
 * account (PAYEEID used as account number when absent), MEMO → remittance, CURRENCY / ORIGCURRENCY → currency /
 * original currency + rate.
 */

export interface OfxNode {
  name: string;
  value?: string;
  children: OfxNode[];
}

const ENTITY_MAP: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]{2,6});/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = parseInt(entity.slice(2), 16);

      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }

    if (entity.startsWith('#')) {
      const code = parseInt(entity.slice(1), 10);

      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }

    return ENTITY_MAP[entity.toLowerCase()] ?? match;
  });
}

/** Reads the OFX 1.x colon header or the OFX 2.x `<?OFX …?>` processing instruction. */
function readHeader(text: string): { version?: string; bodyStart: number } {
  const firstTag = text.indexOf('<');

  if (firstTag === -1) {
    throw new BankStatementParseError('Not an OFX file');
  }

  const sgmlHeader = text.slice(0, firstTag);
  const sgmlVersion = /(?:^|\n)\s*VERSION:\s*(\d{3})/.exec(sgmlHeader);

  if (sgmlVersion) {
    return { version: sgmlVersion[1], bodyStart: firstTag };
  }

  const prolog = text.slice(0, Math.min(text.length, firstTag + 2000));
  const xmlVersion = /<\?OFX[^>]{0,500}?VERSION\s*=\s*"(\d{3})"/i.exec(prolog);

  return { version: xmlVersion?.[1], bodyStart: firstTag };
}

/** Real OFX nesting is < 20 levels; SGML empty leaves add one level each until their parent closes. */
const MAX_DEPTH = 256;

/** Tolerant SGML/XML tokenizer → element tree. Elements left open by SGML are hoisted as empty leaves. */
export function parseOfxTree(text: string, maxNodes = 5_000_000): OfxNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    throw new BankStatementParseError('OFX files with DOCTYPE or ENTITY declarations are not accepted');
  }

  const root: OfxNode = { name: '#root', children: [] };
  const stack: OfxNode[] = [root];
  let nodeCount = 0;
  let pos = 0;
  let pendingLeaf: OfxNode | undefined;
  // SGML leaf: an element that never got an end tag cannot have had children — hoist them to the parent.
  const closeImplicitly = (node: OfxNode, parent: OfxNode): void => {
    if (node.children.length > 0) {
      const index = parent.children.lastIndexOf(node);

      parent.children.splice(index + 1, 0, ...node.children);
      node.children = [];
    }
  };

  while (pos < text.length) {
    const lt = text.indexOf('<', pos);

    if (lt === -1) {
      break;
    }

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);

      pos = end === -1 ? text.length : end + 3;
      continue;
    }

    const gt = text.indexOf('>', lt + 1);

    if (gt === -1) {
      break;
    }

    const tag = text.slice(lt + 1, gt).trim();

    pos = gt + 1;

    if (tag.startsWith('?') || tag.startsWith('!') || tag.length === 0) {
      continue;
    }

    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim().toUpperCase();

      if (pendingLeaf && pendingLeaf.name === name) {
        pendingLeaf = undefined;
        continue;
      }

      pendingLeaf = undefined;

      let index = -1;

      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].name === name) {
          index = i;
          break;
        }
      }

      if (index > 0) {
        while (stack.length - 1 > index) {
          const node = stack.pop() as OfxNode;

          closeImplicitly(node, stack[stack.length - 1]);
        }

        stack.pop();
      }

      continue;
    }

    nodeCount += 1;

    if (nodeCount > maxNodes) {
      throw new BankStatementParseError('OFX file has too many elements');
    }

    const selfClosing = tag.endsWith('/');
    const name = (selfClosing ? tag.slice(0, -1) : tag).trim().split(/\s/)[0].toUpperCase();
    const node: OfxNode = { name, children: [] };

    stack[stack.length - 1].children.push(node);
    pendingLeaf = undefined;

    if (selfClosing) {
      continue;
    }

    // Text directly after the start tag means a leaf (SGML leaves have no end tag).
    const nextLt = text.indexOf('<', pos);
    const following = text.slice(pos, nextLt === -1 ? text.length : nextLt);

    if (following.trim() !== '') {
      node.value = decodeEntities(following.trim());
      pos = nextLt === -1 ? text.length : nextLt;
      pendingLeaf = node;
      continue;
    }

    if (stack.length >= MAX_DEPTH) {
      throw new BankStatementParseError('OFX elements are nested too deeply');
    }

    stack.push(node);
  }

  while (stack.length > 1) {
    const node = stack.pop() as OfxNode;

    closeImplicitly(node, stack[stack.length - 1]);
  }

  return root;
}

function child(node: OfxNode | undefined, name: string): OfxNode | undefined {
  return node?.children.find((c) => c.name === name);
}

function valueOf(node: OfxNode | undefined, name: string): string | undefined {
  const found = child(node, name);

  return found?.value !== undefined ? found.value.trim() || undefined : undefined;
}

function findAll(root: OfxNode, names: Set<string>): OfxNode[] {
  const found: OfxNode[] = [];
  const queue: OfxNode[] = [root];

  for (let i = 0; i < queue.length; i += 1) {
    const node = queue[i];

    if (names.has(node.name)) {
      found.push(node);
      continue;
    }

    queue.push(...node.children);
  }

  return found;
}

/** `YYYYMMDD[HHMMSS[.XXX]][[-5:EST]]` → ISO date (date part only). */
export function ofxDate(value: string | undefined, locator?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());

  if (!match) {
    throw new BankStatementParseError(`Invalid OFX date "${value}"`, locator);
  }

  return isoDate(Number(match[1]), Number(match[2]), Number(match[3]), locator);
}

function nodeText(node: OfxNode): string {
  const inner = node.children.map((c) => nodeText(c)).join('');

  return node.value !== undefined ? `<${node.name}>${node.value}${inner}` : `<${node.name}>${inner}</${node.name}>`;
}

export function parseOfx(text: string, limits: BankParseLimits = DEFAULT_BANK_PARSE_LIMITS): ParsedStatementFile {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const header = readHeader(source);
  const tree = parseOfxTree(source.slice(header.bodyStart), limits.maxTransactions * 40 + 1000);
  const budget = new ParseBudget(limits);
  const warnings: string[] = [];
  const statements: ParsedStatement[] = [];
  const statementNodes = findAll(tree, new Set(['STMTRS', 'CCSTMTRS']));

  if (!child(tree, 'OFX') && statementNodes.length === 0) {
    throw new BankStatementParseError('Not an OFX file (no <OFX> element)');
  }

  for (const trnrs of findAll(tree, new Set(['STMTTRNRS', 'CCSTMTTRNRS']))) {
    const status = child(trnrs, 'STATUS');
    const code = valueOf(status, 'CODE');

    if (code && code !== '0') {
      const message = valueOf(status, 'MESSAGE') ?? valueOf(status, 'SEVERITY') ?? '';

      warnings.push(`OFX statement response status ${code} ${message}`.trim());
    }
  }

  statementNodes.forEach((stmt, stmtIndex) => {
    const locator = `statement ${stmtIndex + 1}`;

    budget.addStatement(locator);

    const currency = normalizeCurrency(valueOf(stmt, 'CURDEF'));

    if (!currency) {
      throw new BankStatementParseError('Statement has no valid CURDEF', locator);
    }

    const accountNode = child(stmt, 'BANKACCTFROM') ?? child(stmt, 'CCACCTFROM');
    const accountId = valueOf(accountNode, 'ACCTID');
    const iban = normalizeIban(accountId);
    const account: ParsedAccountIdentifier = compactObject({
      iban,
      accountNumber: iban ? undefined : accountId,
      bankCode: valueOf(accountNode, 'BANKID'),
      bic: normalizeBic(valueOf(accountNode, 'BANKID')),
    });
    const list = child(stmt, 'BANKTRANLIST');
    const statement: ParsedStatement = {
      kind: 'statement',
      account,
      currency,
      periodFrom: ofxDate(valueOf(list, 'DTSTART'), locator),
      periodTo: ofxDate(valueOf(list, 'DTEND'), locator),
      closingBalance: balanceOf(child(stmt, 'LEDGERBAL'), currency, locator),
      availableBalance: balanceOf(child(stmt, 'AVAILBAL'), currency, locator),
      transactions: [],
    };

    (list?.children ?? [])
      .filter((node) => node.name === 'STMTTRN')
      .forEach((trn, trnIndex) => {
        const trnLocator = `${locator} transaction ${trnIndex + 1}`;

        budget.addTransaction(trnLocator);

        const transaction = parseTransaction(trn, currency, trnLocator, warnings);

        if (transaction) {
          statement.transactions.push(transaction);
        }
      });

    fillPeriodFromTransactions(statement);
    checkBalanceContinuity(statement, `OFX ${locator}`, warnings);
    statements.push(statement);
  });

  return { format: 'ofx', formatVersion: header.version, statements, warnings };
}

function balanceOf(node: OfxNode | undefined, currency: string, locator: string): ParsedBalance | undefined {
  const amount = valueOf(node, 'BALAMT');
  const date = ofxDate(valueOf(node, 'DTASOF'), locator);

  if (!amount || !date) {
    return undefined;
  }

  return { amount: parseLooseAmount(amount, locator), currency, date };
}

function parseTransaction(
  trn: OfxNode,
  currency: string,
  locator: string,
  warnings: string[],
): ParsedTransaction | undefined {
  const correctAction = valueOf(trn, 'CORRECTACTION');

  if (correctAction) {
    warnings.push(`OFX correction (${correctAction}) of ${valueOf(trn, 'CORRECTFITID') ?? '?'} ignored (${locator})`);

    return undefined;
  }

  const bookingDate = ofxDate(valueOf(trn, 'DTPOSTED'), locator);
  const amountRaw = valueOf(trn, 'TRNAMT');

  if (!bookingDate || !amountRaw) {
    throw new BankStatementParseError('Transaction without DTPOSTED or TRNAMT', locator);
  }

  const trnType = valueOf(trn, 'TRNTYPE');
  const payee = child(trn, 'PAYEE');
  const accountTo = child(trn, 'BANKACCTTO') ?? child(trn, 'CCACCTTO');
  const counterpartyAccount = valueOf(accountTo, 'ACCTID') ?? valueOf(trn, 'PAYEEID');
  const counterpartyIban = normalizeIban(counterpartyAccount);
  const txCurrency = normalizeCurrency(valueOf(child(trn, 'CURRENCY'), 'CURSYM'), currency) ?? currency;
  const original = child(trn, 'ORIGCURRENCY');
  const checkNumber = valueOf(trn, 'CHECKNUM');
  const refNumber = valueOf(trn, 'REFNUM');

  return {
    status: 'booked',
    bookingDate,
    valueDate: ofxDate(valueOf(trn, 'DTUSER') ?? valueOf(trn, 'DTAVAIL'), locator),
    amount: parseLooseAmount(amountRaw, locator),
    currency: txCurrency,
    isReversal: false,
    bankTransactionCode: trnType ? { national: trnType } : undefined,
    bookingText: trnType,
    bankReference: valueOf(trn, 'FITID'),
    entryReference: checkNumber ?? refNumber,
    isBatch: false,
    details: [
      finalizeDetail({
        remittance: valueOf(trn, 'MEMO'),
        instructionId: refNumber,
        originalCurrency: normalizeCurrency(valueOf(original, 'CURSYM')),
        exchangeRate: valueOf(original, 'CURRATE'),
        counterparty: {
          name: cleanText(valueOf(trn, 'NAME') ?? valueOf(payee, 'NAME') ?? valueOf(trn, 'EXTDNAME')),
          iban: counterpartyIban,
          accountNumber: counterpartyIban ? undefined : counterpartyAccount,
        },
      }),
    ],
    locator,
    raw: rawText([nodeText(trn)]),
  };
}
