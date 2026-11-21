import { cleanText, normalizeBic, normalizeIban } from '../bank-parse.utils';

/**
 * German SEPA purpose keywords (DK "Verwendungszweck" structure) as found in MT940 `:86:` ?20–?29 subfields and in
 * camt documents converted from MT940 (packed into `RmtInf/Ustrd`).
 */
export interface SepaPurposeFields {
  /** `EREF+` (NOTPROVIDED dropped). */
  endToEndId?: string;
  /** `KREF+` customer reference (usually the payment information id of the sender's batch). */
  customerReference?: string;
  /** `MREF+` mandate reference. */
  mandateId?: string;
  /** `CRED+` creditor identifier. */
  creditorId?: string;
  /** `DEBT+` originator identifier. */
  debtorId?: string;
  /** `COAM+` compensation amount (raw text). */
  compensationAmount?: string;
  /** `OAMT+` original amount (raw text). */
  originalAmount?: string;
  /** `SVWZ+` remittance; falls back to text before the first keyword. */
  remittance?: string;
  /** `ABWA+` ultimate debtor ("abweichender Auftraggeber"). */
  ultimateDebtor?: string;
  /** `ABWE+` ultimate creditor ("abweichender Empfänger"). */
  ultimateCreditor?: string;
  iban?: string;
  bic?: string;
}

type SepaKeyword =
  | 'EREF'
  | 'KREF'
  | 'MREF'
  | 'CRED'
  | 'DEBT'
  | 'COAM'
  | 'OAMT'
  | 'SVWZ'
  | 'ABWA'
  | 'ABWE'
  | 'IBAN'
  | 'BIC';

/**
 * Splits a purpose text by SEPA keywords. Returns `undefined` when the text contains no keyword (caller then uses
 * the whole text as remittance).
 */
export function parseSepaPurpose(text: string | undefined): SepaPurposeFields | undefined {
  if (!text) {
    return undefined;
  }

  const keywordRe = /(EREF|KREF|MREF|CRED|DEBT|COAM|OAMT|SVWZ|ABWA|ABWE|IBAN|BIC)\+/g;
  const matches = Array.from(text.matchAll(keywordRe));

  if (matches.length === 0) {
    return undefined;
  }

  const values = new Map<SepaKeyword, string>();

  matches.forEach((match, idx) => {
    const start = (match.index ?? 0) + match[0].length;
    const next = matches[idx + 1];
    const end = next ? (next.index ?? text.length) : text.length;
    const value = cleanText(text.slice(start, end));
    const keyword = match[1] as SepaKeyword;

    if (!value) {
      return;
    }

    const existing = values.get(keyword);

    values.set(keyword, existing ? `${existing} ${value}` : value);
  });

  const leading = cleanText(text.slice(0, matches[0].index ?? 0));
  const result: SepaPurposeFields = {};
  const eref = values.get('EREF');

  if (eref && eref.toUpperCase() !== 'NOTPROVIDED') {
    result.endToEndId = eref;
  }

  assign(result, 'customerReference', notProvided(values.get('KREF')));
  assign(result, 'mandateId', values.get('MREF'));
  assign(result, 'creditorId', values.get('CRED'));
  assign(result, 'debtorId', values.get('DEBT'));
  assign(result, 'compensationAmount', values.get('COAM'));
  assign(result, 'originalAmount', values.get('OAMT'));
  assign(result, 'remittance', values.get('SVWZ') ?? leading);
  assign(result, 'ultimateDebtor', values.get('ABWA'));
  assign(result, 'ultimateCreditor', values.get('ABWE'));
  assign(result, 'iban', normalizeIban(values.get('IBAN')));
  assign(result, 'bic', normalizeBic(values.get('BIC')));

  return result;
}

function notProvided(value: string | undefined): string | undefined {
  return value && value.toUpperCase() !== 'NOTPROVIDED' ? value : undefined;
}

function assign<K extends keyof SepaPurposeFields>(
  target: SepaPurposeFields,
  key: K,
  value: SepaPurposeFields[K],
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}
