import * as iconv from 'iconv-lite';

const LINE_ENDING = '\r\n';
/** Fallback transliteration for characters outside Windows-1252 after decomposition. */
const GERMAN_UMLAUT_TRANSLITERATION: Readonly<Record<string, string>> = {
  // Letters without a Unicode decomposition that Windows-1252 cannot hold.
  Ł: 'L',
  ł: 'l',
  Đ: 'D',
  đ: 'd',
  Ħ: 'H',
  ħ: 'h',
  ı: 'i',
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
  ß: 'ss',
};

/**
 * EXTF data must be Windows-1252. Characters Windows-1252 can represent (umlauts, accents, €) are kept so names
 * match DATEV master data exactly; anything else is decomposed (NFKD, diacritics dropped) or removed. Control
 * characters never pass.
 */
export function sanitizeDatevText(value: string): string {
  let result = '';

  for (const char of value.normalize('NFC')) {
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001F\u007F]/.test(char)) {
      continue;
    }

    if (isWin1252Representable(char)) {
      result += char;
      continue;
    }

    const decomposed = char.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

    for (const part of decomposed) {
      // eslint-disable-next-line no-control-regex
      if (isWin1252Representable(part) && !/[\u0000-\u001F\u007F]/.test(part)) {
        result += part;
      } else if (GERMAN_UMLAUT_TRANSLITERATION[part]) {
        result += GERMAN_UMLAUT_TRANSLITERATION[part];
      }
    }
  }

  return result.trim();
}

const win1252Cache = new Map<string, boolean>();

function isWin1252Representable(char: string): boolean {
  let ok = win1252Cache.get(char);

  if (ok === undefined) {
    ok = iconv.decode(iconv.encode(char, 'win1252'), 'win1252') === char;
    win1252Cache.set(char, ok);
  }

  return ok;
}

export function parseBooleanEnv(envKey: string, fallback: boolean): boolean {
  const raw = process.env[envKey];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();

  if (normalized === 'true' || normalized === '1') {
    return true;
  }

  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return fallback;
}

export function parseCsvTenantIds(envKey: string, fallback: readonly string[]): readonly string[] {
  const raw = process.env[envKey];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const ids = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return ids.length > 0 ? ids : fallback;
}

export function formatDatevAmount(value: number): string {
  const normalized = Math.abs(Number(value));

  return normalized.toFixed(2).replace('.', ',');
}

export function formatDatevDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${day}${month}${year}`;
}

export function formatDatevTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  const millis = String(date.getUTCMilliseconds()).padStart(3, '0');

  return `${year}${month}${day}${hours}${minutes}${seconds}${millis}`;
}

export function formatDatevHeaderDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}${month}${day}`;
}

export function escapeDatevField(value: string | number | undefined | null): string {
  if (value === undefined || value === null) {
    return '';
  }

  const text = sanitizeDatevText(String(value));

  if (text.includes(';') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function joinDatevRow(fields: string[]): string {
  return fields.map((field) => escapeDatevField(field)).join(';');
}

export function joinDatevLines(lines: string[]): string {
  return `${lines.join(LINE_ENDING)}${LINE_ENDING}`;
}

export function encodeDatevCsv(content: string): Buffer {
  return iconv.encode(content, 'win1252');
}

export function truncateDatevText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength);
}

export interface DatevExportPeriod {
  year: number;
  month: number;
  periodStart: Date;
  periodEnd: Date;
}

export function resolvePreviousCalendarMonth(timezone: string, reference = new Date()): DatevExportPeriod {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  });
  const parts = formatter.formatToParts(reference);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  let targetYear = year;
  let targetMonth = month - 1;

  if (targetMonth < 1) {
    targetMonth = 12;
    targetYear -= 1;
  }

  const periodStart = new Date(Date.UTC(targetYear, targetMonth - 1, 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(targetYear, targetMonth, 0, 23, 59, 59, 999));

  return {
    year: targetYear,
    month: targetMonth,
    periodStart,
    periodEnd,
  };
}

export function buildDatevExportFileName(scope: 'tenant' | 'unified', year: number, month: number): string {
  const monthLabel = String(month).padStart(2, '0');

  if (scope === 'unified') {
    return `datev-export-unified-${year}-${monthLabel}.zip`;
  }

  return `datev-export-${year}-${monthLabel}.zip`;
}

export function buildDatevStorageKey(
  scope: 'tenant' | 'unified',
  tenantId: string,
  year: number,
  month: number,
  fileName: string,
): string {
  const monthLabel = String(month).padStart(2, '0');

  if (scope === 'unified') {
    return `${tenantId}/_unified/${year}/${monthLabel}/${fileName}`;
  }

  return `${tenantId}/${year}/${monthLabel}/${fileName}`;
}
