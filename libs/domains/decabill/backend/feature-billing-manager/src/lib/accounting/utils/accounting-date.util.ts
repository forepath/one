/** ISO date helpers for bookkeeping dates (`YYYY-MM-DD`, calendar arithmetic in UTC). */

function parse(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = parse(iso);

  date.setUTCDate(date.getUTCDate() + days);

  return format(date);
}

/** Adds months; the day is clamped to the target month's length. */
export function addMonths(iso: string, months: number): string {
  const date = parse(iso);
  const day = date.getUTCDate();

  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);

  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();

  date.setUTCDate(Math.min(day, lastDay));

  return format(date);
}

export function endOfMonth(iso: string): string {
  return addDays(addMonths(`${iso.slice(0, 7)}-01`, 1), -1);
}

export function resolveAccountingTimezone(): string {
  const tz = (
    process.env.BILLING_ACCOUNTING_TIMEZONE ??
    process.env.BILLING_DATEV_EXPORT_TIMEZONE ??
    'Europe/Berlin'
  ).trim();

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });

    return tz;
  } catch {
    return 'Europe/Berlin';
  }
}

/** Calendar date of a timestamp in the bookkeeping time zone (a payment at 00:30 Berlin time is that day). */
export function toBookingDate(value: Date | string | null | undefined, timeZone = resolveAccountingTimezone()): string {
  if (!value) {
    return isoToday(timeZone);
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = typeof value === 'string' ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    return isoToday(timeZone);
  }

  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function isoToday(timeZone = resolveAccountingTimezone()): string {
  return toBookingDate(new Date(), timeZone);
}

/** Inclusive date range check on ISO strings. */
export function isWithin(iso: string, from: string, to: string): boolean {
  return iso >= from && iso <= to;
}

/** Quarter (1–4) of an ISO date. */
export function quarterOf(iso: string): number {
  return Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;
}
