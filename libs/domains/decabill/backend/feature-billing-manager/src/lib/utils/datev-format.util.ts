import * as iconv from 'iconv-lite';

const LINE_ENDING = '\r\n';

/** DATEV ignores column header row 2; ASCII labels avoid mojibake in UTF-8 editors. */
const GERMAN_UMLAUT_TRANSLITERATION: Readonly<Record<string, string>> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
  ß: 'ss',
};

/**
 * EXTF data must be Windows-1252 for DATEV import, but CP1252 bytes are often opened as UTF-8
 * in editors (broken umlauts). Row-2 headers are ignored by DATEV, so we use ASCII there.
 * Dynamic field values are transliterated to ASCII-safe text before encoding.
 */
export function sanitizeDatevText(value: string): string {
  let result = value.normalize('NFKC');

  for (const [umlaut, replacement] of Object.entries(GERMAN_UMLAUT_TRANSLITERATION)) {
    result = result.split(umlaut).join(replacement);
  }

  return result.replace(/[^\u0020-\u007E]/g, '').trim();
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
