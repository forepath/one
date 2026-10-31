/**
 * Shared display formats of the consoles (X-04 / DB-03 / DB-05 / DB-27, 2026-10-29): one money format, one date and
 * one date-time format (no seconds) per locale, date ranges, relative times for feeds and real plural forms for
 * counted units. Plain functions (usable in TS, chart formatters, CSV) with thin pipes on top (`format.pipes.ts`).
 *
 * Every function takes the app locale (`LOCALE_ID`, e.g. `en-US` / `de`) and returns `''` (or the given `fallback`)
 * for empty / invalid input, so templates never print `Invalid Date` / `NaN`.
 */

export type FpcDateInput = Date | string | number | null | undefined;

/** Calendar units for counted durations ("1 month", "3 months", "14 days"). */
export type FpcDurationUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

export interface FpcMoneyOptions {
  /**
   * Unit / meter prices: amounts below 0.01 keep up to 4 decimals (`€0.004`) instead of rounding to `€0.00`.
   * Default `false` (always 2 decimals).
   */
  unitPrice?: boolean;
  /** Compact notation for chart axes / tight cells (`€25K`, `25.000 €` → `25.000 €` / `25 Tsd. €`). */
  compact?: boolean;
  /** Returned for empty / invalid amounts (default `''`). */
  fallback?: string;
}

export interface FpcDateRangeLabels {
  /** Open end: `{date}` = the start (default `from {date}`). */
  from?: string;
  /** Open start: `{date}` = the end (default `until {date}`). */
  until?: string;
}

const NUMBER_FORMATS = new Map<string, Intl.NumberFormat>();
const DATE_FORMATS = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = NUMBER_FORMATS.get(key);

  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    NUMBER_FORMATS.set(key, format);
  }

  return format;
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = DATE_FORMATS.get(key);

  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    DATE_FORMATS.set(key, format);
  }

  return format;
}

/** `Date` from a date / ISO string / epoch ms; `null` when empty or invalid. */
export function fpcToDate(value: FpcDateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function toAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;

  const amount = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(amount) ? amount : null;
}

/**
 * Money in the locale's grouping and symbol position, 2 decimals (`€65,059.45` / `65.059,45 €`). Unit prices below
 * 0.01 keep up to 4 decimals (`unitPrice`); `compact` for axes (`€25K`). `currency` is an ISO 4217 code (default EUR).
 */
export function fpcFormatMoney(
  value: number | string | null | undefined,
  currency: string | null | undefined,
  locale: string,
  options: FpcMoneyOptions = {},
): string {
  const amount = toAmount(value);

  if (amount === null) return options.fallback ?? '';

  const code = (currency || 'EUR').toUpperCase();

  if (options.compact) {
    return numberFormat(locale, {
      style: 'currency',
      currency: code,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount);
  }

  const tiny = options.unitPrice && amount !== 0 && Math.abs(amount) < 0.01;

  return numberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: tiny ? 4 : 2,
  }).format(amount);
}

/** Plain number in the locale's grouping (`1,234.5`); `fractionDigits` fixes the decimals. */
export function fpcFormatNumber(
  value: number | string | null | undefined,
  locale: string,
  fractionDigits: number | null = null,
  fallback = '',
): string {
  const amount = toAmount(value);

  if (amount === null) return fallback;

  return numberFormat(
    locale,
    fractionDigits === null
      ? { maximumFractionDigits: 2 }
      : { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits },
  ).format(amount);
}

/** The one table date: medium date (`Oct 29, 2026` / `29.10.2026`). */
export function fpcFormatDate(value: FpcDateInput, locale: string, fallback = ''): string {
  const date = fpcToDate(value);

  return date ? dateFormat(locale, { dateStyle: 'medium' }).format(date) : fallback;
}

/** The one table date-time: medium date + short time, never seconds (`Oct 29, 2026, 10:05 AM`). */
export function fpcFormatDateTime(value: FpcDateInput, locale: string, fallback = ''): string {
  const date = fpcToDate(value);

  return date ? dateFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : fallback;
}

/** Time of day without seconds (`10:05 AM` / `10:05`). */
export function fpcFormatTime(value: FpcDateInput, locale: string, fallback = ''): string {
  const date = fpcToDate(value);

  return date ? dateFormat(locale, { timeStyle: 'short' }).format(date) : fallback;
}

/**
 * A date range in one piece (`Oct 9 – Dec 31, 2026`; `withTime`: `Oct 9, 2026, 11:10 AM – Dec 31, 2026, 11:59 PM`).
 * Open ranges: `from Oct 29, 2026` / `until Dec 31, 2026` (labels from the app, `{date}` placeholder); both open →
 * `fallback`.
 */
export function fpcFormatDateRange(
  start: FpcDateInput,
  end: FpcDateInput,
  locale: string,
  options: { withTime?: boolean; labels?: FpcDateRangeLabels; fallback?: string } = {},
): string {
  const from = fpcToDate(start);
  const to = fpcToDate(end);
  const format = dateFormat(
    locale,
    options.withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
  );

  if (from && to) {
    // `formatRange` is ES2021 Intl (the workspace `lib` is ES2020); every supported browser has it.
    const ranged = format as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string };

    return ranged.formatRange ? ranged.formatRange(from, to) : `${format.format(from)} – ${format.format(to)}`;
  }
  if (from) return (options.labels?.from ?? 'from {date}').replace('{date}', format.format(from));
  if (to) return (options.labels?.until ?? 'until {date}').replace('{date}', format.format(to));

  return options.fallback ?? '';
}

const RELATIVE_STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.345],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
];

/**
 * Relative time for feeds / rails (`2 hr. ago`, `in 3 days`, `now`); older than `absoluteAfterDays` (default 7) falls
 * back to the medium date. `now` is injectable for tests.
 */
export function fpcFormatRelative(
  value: FpcDateInput,
  locale: string,
  options: { now?: Date | number; absoluteAfterDays?: number; fallback?: string } = {},
): string {
  const date = fpcToDate(value);

  if (!date) return options.fallback ?? '';

  const now = options.now instanceof Date ? options.now.getTime() : (options.now ?? Date.now());
  let delta = (date.getTime() - now) / 1000;
  const limit = (options.absoluteAfterDays ?? 7) * 86400;

  if (Math.abs(delta) >= limit) return fpcFormatDate(date, locale);

  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });

  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(delta) < size) return format.format(Math.round(delta), unit);
    delta /= size;
  }

  return fpcFormatDate(date, locale);
}

/**
 * A counted calendar unit with its real plural form, translated by the platform (`1 month`, `3 months`, `14 days`,
 * de: `1 Monat`, `3 Monate`). Replaces `month(s)` strings.
 */
export function fpcFormatDuration(
  count: number | null | undefined,
  unit: FpcDurationUnit,
  locale: string,
  fallback = '',
): string {
  if (count === null || count === undefined || !Number.isFinite(count)) return fallback;

  return numberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(count);
}

/**
 * Picks the plural form for `count` (CLDR rules of `locale`) and fills `{count}`. Pass translated forms, e.g.
 * `fpcPlural(n, { one: $localize`:@@x-one:{count} highlight`, other: $localize`:@@x-other:{count} highlights` }, locale)`.
 * Templates should prefer ICU (`{n, plural, =1 {…} other {…}}`); this is for TS-built strings.
 */
export function fpcPlural(
  count: number,
  forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string },
  locale: string,
): string {
  const exact = count === 0 ? forms.zero : undefined;
  const rule = new Intl.PluralRules(locale).select(count);
  const form = exact ?? forms[rule] ?? forms.other;

  return form.replace('{count}', fpcFormatNumber(count, locale));
}
