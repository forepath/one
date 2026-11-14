export function toAmount(value: number | string | null | undefined): number {
  const amount = Number(value);

  return Number.isFinite(amount) ? amount : 0;
}

export function formatAmount(value: number | string | null | undefined): string {
  return toAmount(value).toFixed(2);
}

/** "Service date" for a single day, else "Service period" with an en-dash range (YYYY-MM-DD). */
export function formatServicePeriod(
  period: { periodStart: Date; periodEnd: Date } | null | undefined,
): { label: string; value: string } | undefined {
  const start = formatDate(period?.periodStart);
  const end = formatDate(period?.periodEnd);

  if (!start || !end) {
    return undefined;
  }

  return start === end
    ? { label: 'Service date', value: start }
    : { label: 'Service period', value: `${start} – ${end}` };
}

export function formatDate(value: Date | string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}
