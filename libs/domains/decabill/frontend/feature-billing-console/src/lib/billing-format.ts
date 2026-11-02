import {
  fpcFormatDate,
  fpcFormatDateRange,
  fpcFormatDateTime,
  fpcFormatMoney,
  fpcFormatTime,
  type FpcDateInput,
  type FpcMoneyOptions,
} from '@forepath/shared/frontend/ui-components';

/** Billing currency when a response carries none (Decabill bills in EUR). */
export const DEFAULT_BILLING_CURRENCY = 'EUR';

/**
 * The app locale (same source as Angular's default `LOCALE_ID`: `$localize.locale` in localized builds), for the
 * formatting helpers used outside an injection context (column value functions, utils, chart formatters).
 */
export function billingLocale(): string {
  const localize = (globalThis as { $localize?: { locale?: string } }).$localize;

  return localize?.locale || 'en-US';
}

/**
 * The one money format of the console (DB-03): locale grouping and symbol, 2 decimals (`€65,059.45` /
 * `65.059,45 €`). `unitPrice` keeps up to 4 decimals below 0.01 (`€0.004`). Empty / invalid → `fallback` (`-`).
 */
export function formatBillingMoney(
  value: number | string | null | undefined,
  currency: string | null | undefined = DEFAULT_BILLING_CURRENCY,
  options: FpcMoneyOptions = {},
): string {
  return fpcFormatMoney(value, currency || DEFAULT_BILLING_CURRENCY, billingLocale(), { fallback: '-', ...options });
}

/** The one table date (DB-05): medium date (`Oct 29, 2026`). */
export function formatBillingDate(value: FpcDateInput, fallback = '-'): string {
  return fpcFormatDate(value, billingLocale(), fallback);
}

/** The one table date-time (DB-05): medium date + short time, never seconds. */
export function formatBillingDateTime(value: FpcDateInput, fallback = '-'): string {
  return fpcFormatDateTime(value, billingLocale(), fallback);
}

/** Time of day (DB-05): short time in the app locale (`10:05 AM`); chart buckets of short spans. */
export function formatBillingTime(value: FpcDateInput, fallback = '-'): string {
  return fpcFormatTime(value, billingLocale(), fallback);
}

/** Date range (DB-05): `Oct 9 – Dec 31, 2026`; open end → "from Oct 29, 2026". */
export function formatBillingDateRange(start: FpcDateInput, end: FpcDateInput, fallback = '-'): string {
  return fpcFormatDateRange(start, end, billingLocale(), {
    fallback,
    labels: {
      from: $localize`:@@featureBilling-dateRangeFrom:from {date}`,
      until: $localize`:@@featureBilling-dateRangeUntil:until {date}`,
    },
  });
}

/**
 * Time-entry clock range (DB-05): same day → `10:05 AM – 11:30 AM`; across days → both date-times (no seconds),
 * in the app locale instead of the browser's `toLocaleString()`.
 */
export function formatBillingClockRange(startedAt: FpcDateInput, endedAt: FpcDateInput): string {
  const start = startedAt == null ? null : new Date(startedAt);
  const end = endedAt == null ? null : new Date(endedAt);

  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return '-';
  }

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  const locale = billingLocale();

  return sameDay
    ? `${fpcFormatTime(start, locale)} – ${fpcFormatTime(end, locale)}`
    : `${formatBillingDateTime(start)} – ${formatBillingDateTime(end)}`;
}
