import * as iconv from 'iconv-lite';

import { BankStatementParseError, type ParsedStructuredReference } from './bank-import.types';

export type TextEncoding = 'utf-8' | 'windows-1252' | 'iso-8859-1' | 'cp850';

/**
 * Decodes an uploaded file. `auto`: BOM → UTF-8/UTF-16, strict UTF-8 when valid, else windows-1252.
 * NUL bytes are rejected (binary input).
 */
export function decodeText(
  buffer: Buffer,
  encoding: 'auto' | TextEncoding = 'auto',
): { text: string; encoding: TextEncoding | 'utf-16le' | 'utf-16be' } {
  if (encoding !== 'auto') {
    return { text: stripBom(iconv.decode(buffer, encoding)), encoding };
  }

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf-8' };
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: iconv.decode(buffer.subarray(2), 'utf-16le'), encoding: 'utf-16le' };
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { text: iconv.decode(buffer.subarray(2), 'utf-16be'), encoding: 'utf-16be' };
  }

  if (buffer.includes(0)) {
    throw new BankStatementParseError('File contains NUL bytes and is not a text statement');
  }

  if (isValidUtf8(buffer)) {
    return { text: buffer.toString('utf8'), encoding: 'utf-8' };
  }

  return { text: iconv.decode(buffer, 'windows-1252'), encoding: 'windows-1252' };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isValidUtf8(buffer: Buffer): boolean {
  let i = 0;

  while (i < buffer.length) {
    const byte = buffer[i];

    if (byte < 0x80) {
      i += 1;
      continue;
    }

    let needed: number;

    if (byte >= 0xc2 && byte <= 0xdf) {
      needed = 1;
    } else if (byte >= 0xe0 && byte <= 0xef) {
      needed = 2;
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      needed = 3;
    } else {
      return false;
    }

    if (i + needed >= buffer.length) {
      return false;
    }

    for (let k = 1; k <= needed; k += 1) {
      const next = buffer[i + k];

      if (next === undefined || (next & 0xc0) !== 0x80) {
        return false;
      }
    }

    i += needed + 1;
  }

  return true;
}

/** Splits text into lines (CRLF, LF, CR) and enforces a maximum line length. */
export function splitLines(text: string, maxLineLength = 100_000): string[] {
  const lines = text.split(/\r\n|\n|\r/);

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].length > maxLineLength) {
      throw new BankStatementParseError('Line exceeds the maximum length', `line ${i + 1}`);
    }
  }

  return lines;
}

/** NFC-normalizes, removes control characters and collapses whitespace. */
export function cleanText(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  // eslint-disable-next-line no-control-regex
  const cleaned = value.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  const collapsed = cleaned.replace(/\s+/g, ' ').trim();

  return collapsed.length > 0 ? collapsed : undefined;
}

export function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value.length > max ? value.slice(0, max) : value;
}

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Normalizes a localized amount to a canonical decimal string (`-1234.5` → `-1234.50` is NOT padded; scale is
 * kept as given). Accepts a leading/trailing sign and surrounding whitespace.
 */
export function normalizeDecimal(raw: string, decimalSeparator: '.' | ',', thousandsSeparator?: string): string {
  let value = raw.trim().replace(/\u00a0/g, ' ');
  let negative = false;

  if (value.startsWith('(') && value.endsWith(')')) {
    negative = true;
    value = value.slice(1, -1).trim();
  }

  if (value.startsWith('-') || value.startsWith('−')) {
    negative = !negative;
    value = value.slice(1).trim();
  } else if (value.startsWith('+')) {
    value = value.slice(1).trim();
  }

  if (value.endsWith('-')) {
    negative = !negative;
    value = value.slice(0, -1).trim();
  } else if (value.endsWith('+')) {
    value = value.slice(0, -1).trim();
  }

  if (thousandsSeparator) {
    value = value.split(thousandsSeparator).join('');
  }

  value = value.replace(/ /g, '');

  if (decimalSeparator === ',') {
    value = value.replace(',', '.');
  }

  if (value.startsWith('.')) {
    value = `0${value}`;
  }

  if (value.endsWith('.')) {
    value = value.slice(0, -1);
  }

  if (!DECIMAL_RE.test(value)) {
    throw new BankStatementParseError(`Invalid amount "${raw}"`);
  }

  value = value.replace(/^0+(?=\d)/, '');

  return negative && !/^0+(\.0+)?$/.test(value) ? `-${value}` : value;
}

export function negateDecimal(value: string): string {
  if (/^-?0+(\.0+)?$/.test(value)) {
    return value.replace('-', '');
  }

  return value.startsWith('-') ? value.slice(1) : `-${value}`;
}

export function isNegativeDecimal(value: string): boolean {
  return value.startsWith('-');
}

/** `"0000012345"`, 2 → `"123.45"`. */
export function impliedDecimal(digits: string, decimals: number): string {
  const clean = digits.trim();

  if (!/^\d+$/.test(clean)) {
    throw new BankStatementParseError(`Invalid numeric field "${digits}"`);
  }

  if (decimals === 0) {
    return clean.replace(/^0+(?=\d)/, '');
  }

  const padded = clean.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, -decimals).replace(/^0+(?=\d)/, '');

  return `${intPart}.${padded.slice(-decimals)}`;
}

/** Sums decimal strings exactly (scaled bigint arithmetic). */
export function sumDecimals(values: string[]): string {
  const scale = values.reduce((max, v) => Math.max(max, (v.split('.')[1] ?? '').length), 0);
  let total = BigInt(0);

  for (const v of values) {
    total += toScaled(v, scale);
  }

  return fromScaled(total, scale);
}

export function compareDecimals(a: string, b: string): number {
  const scale = Math.max((a.split('.')[1] ?? '').length, (b.split('.')[1] ?? '').length);
  const diff = toScaled(a, scale) - toScaled(b, scale);

  return diff === BigInt(0) ? 0 : diff > BigInt(0) ? 1 : -1;
}

function toScaled(value: string, scale: number): bigint {
  const negative = value.startsWith('-');
  const [intPart, fracPart = ''] = (negative ? value.slice(1) : value).split('.');
  const scaled = BigInt(`${intPart}${fracPart.padEnd(scale, '0')}`);

  return negative ? -scaled : scaled;
}

function fromScaled(value: bigint, scale: number): string {
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const result = scale > 0 ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;

  return negative ? `-${result}` : result;
}

/** Builds and validates an ISO date. */
export function isoDate(year: number, month: number, day: number, locator?: string): string {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    !Number.isFinite(year) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BankStatementParseError(`Invalid date ${year}-${month}-${day}`, locator);
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Two-digit year → four digits (pivot: 00–79 → 20xx, 80–99 → 19xx). */
export function expandYear(twoDigits: number): number {
  return twoDigits >= 80 ? 1900 + twoDigits : 2000 + twoDigits;
}

/** `YYMMDD` → ISO date. */
export function yymmddToIso(value: string, locator?: string): string {
  if (!/^\d{6}$/.test(value)) {
    throw new BankStatementParseError(`Invalid YYMMDD date "${value}"`, locator);
  }

  return isoDate(expandYear(Number(value.slice(0, 2))), Number(value.slice(2, 4)), Number(value.slice(4, 6)), locator);
}

/** `DDMMYY` → ISO date. */
export function ddmmyyToIso(value: string, locator?: string): string {
  if (!/^\d{6}$/.test(value)) {
    throw new BankStatementParseError(`Invalid DDMMYY date "${value}"`, locator);
  }

  return isoDate(expandYear(Number(value.slice(4, 6))), Number(value.slice(2, 4)), Number(value.slice(0, 2)), locator);
}

/**
 * Parses a date with a pattern of `DD`, `MM`, `YY`, `YYYY` tokens (e.g. `DD.MM.YYYY`, `YYYY-MM-DD`, `MM/DD/YY`).
 * Trailing time parts after the pattern are ignored.
 */
export function parseDatePattern(value: string, pattern: string, locator?: string): string {
  const tokens: Array<'DD' | 'MM' | 'YY' | 'YYYY'> = [];
  let regex = '^';
  let i = 0;

  while (i < pattern.length) {
    if (pattern.startsWith('YYYY', i)) {
      tokens.push('YYYY');
      regex += '(\\d{4})';
      i += 4;
    } else if (pattern.startsWith('YY', i)) {
      tokens.push('YY');
      regex += '(\\d{2})';
      i += 2;
    } else if (pattern.startsWith('MM', i)) {
      tokens.push('MM');
      regex += '(\\d{1,2})';
      i += 2;
    } else if (pattern.startsWith('DD', i)) {
      tokens.push('DD');
      regex += '(\\d{1,2})';
      i += 2;
    } else {
      regex += pattern[i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      i += 1;
    }
  }

  const match = new RegExp(regex).exec(value.trim());

  if (!match) {
    throw new BankStatementParseError(`Date "${value}" does not match pattern ${pattern}`, locator);
  }

  let year = 0;
  let month = 0;
  let day = 0;

  tokens.forEach((token, idx) => {
    const n = Number(match[idx + 1]);

    if (token === 'YYYY') year = n;
    else if (token === 'YY') year = expandYear(n);
    else if (token === 'MM') month = n;
    else day = n;
  });

  return isoDate(year, month, day, locator);
}

/** Removes spaces, uppercases and validates the IBAN checksum (ISO 13616 mod 97). */
export function normalizeIban(value: string | undefined | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const iban = value.replace(/[\s-]/g, '').toUpperCase();

  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) {
    return undefined;
  }

  return mod97(`${iban.slice(4)}${iban.slice(0, 4)}`) === 1 ? iban : undefined;
}

/** Builds an IBAN from a country code and BBAN (computes the check digits). */
export function ibanFromBban(countryCode: string, bban: string): string {
  const clean = bban.replace(/[\s-]/g, '').toUpperCase();
  const check = 98 - mod97(`${clean}${countryCode.toUpperCase()}00`);

  return `${countryCode.toUpperCase()}${String(check).padStart(2, '0')}${clean}`;
}

/** Mod 97 over an alphanumeric string with letters mapped A=10 … Z=35 (ISO 7064). */
export function mod97(value: string): number {
  let remainder = 0;

  for (const char of value.toUpperCase()) {
    const code = char.charCodeAt(0);
    const digits = code >= 65 && code <= 90 ? String(code - 55) : char;

    for (const digit of digits) {
      if (digit < '0' || digit > '9') {
        return -1;
      }

      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  return remainder;
}

export function normalizeBic(value: string | undefined | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const bic = value.replace(/\s/g, '').toUpperCase();

  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic) ? bic : undefined;
}

/** True when `value` is a valid ISO 11649 creditor reference (`RF` + 2 check digits + up to 21 chars). */
export function isValidRfReference(value: string): boolean {
  const ref = value.replace(/\s/g, '').toUpperCase();

  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(ref)) {
    return false;
  }

  return mod97(`${ref.slice(4)}${ref.slice(0, 4)}`) === 1;
}

/** Belgian structured communication (OGM/VCS): 10 digits + 2 check digits (mod 97, 0 → 97). */
export function isValidBelgianOgm(value: string): boolean {
  const digits = value.replace(/[^\d]/g, '');

  if (digits.length !== 12) {
    return false;
  }

  const base = Number(digits.slice(0, 10)) % 97;
  const check = base === 0 ? 97 : base;

  return check === Number(digits.slice(10));
}

/** Swiss QR reference: 27 digits, recursive mod 10 check digit. */
export function isValidQrReference(value: string): boolean {
  const digits = value.replace(/\s/g, '');

  if (!/^\d{27}$/.test(digits)) {
    return false;
  }

  const table = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
  let carry = 0;

  for (const digit of digits.slice(0, 26)) {
    carry = table[(carry + Number(digit)) % 10];
  }

  return (10 - carry) % 10 === Number(digits[26]);
}

/** Finds check-digit-valid structured references (RF, Belgian OGM) inside free text. */
export function extractStructuredReferences(text: string | undefined): ParsedStructuredReference[] {
  if (!text) {
    return [];
  }

  const found: ParsedStructuredReference[] = [];
  const seen = new Set<string>();
  const compact = text.toUpperCase();

  for (const match of compact.matchAll(/RF\d{2}(?:\s?[A-Z0-9]){1,21}/g)) {
    const candidate = match[0].replace(/\s/g, '');

    // Try the longest prefix that validates (free text may continue right after the reference).
    for (let len = candidate.length; len >= 5; len -= 1) {
      const ref = candidate.slice(0, len);

      if (isValidRfReference(ref)) {
        if (!seen.has(ref)) {
          seen.add(ref);
          found.push({ type: 'SCOR', reference: ref });
        }

        break;
      }
    }
  }

  for (const match of text.matchAll(/(?:\+\+\+|\*\*\*)\s*(\d{3})\s*\/\s*(\d{4})\s*\/\s*(\d{5})\s*(?:\+\+\+|\*\*\*)/g)) {
    const ref = `${match[1]}${match[2]}${match[3]}`;

    if (isValidBelgianOgm(ref) && !seen.has(ref)) {
      seen.add(ref);
      found.push({ type: 'BBA', reference: ref });
    }
  }

  return found;
}

/** Currency code check (ISO 4217 alpha-3 shape). */
export function normalizeCurrency(value: string | undefined | null, fallback?: string): string | undefined {
  const code = (value ?? '').trim().toUpperCase();

  if (/^[A-Z]{3}$/.test(code)) {
    return code;
  }

  return fallback;
}

/** ISO 4217 numeric → alpha (subset relevant for European bank formats). */
const NUMERIC_CURRENCIES: Record<string, string> = {
  '978': 'EUR',
  '840': 'USD',
  '826': 'GBP',
  '756': 'CHF',
  '752': 'SEK',
  '578': 'NOK',
  '208': 'DKK',
  '985': 'PLN',
  '203': 'CZK',
  '348': 'HUF',
  '946': 'RON',
  '975': 'BGN',
  '392': 'JPY',
  '124': 'CAD',
  '036': 'AUD',
};

export function currencyFromNumeric(code: string): string | undefined {
  return NUMERIC_CURRENCIES[code.trim().padStart(3, '0')];
}
