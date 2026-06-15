export function toAmount(value: number | string | null | undefined): number {
  const amount = Number(value);

  return Number.isFinite(amount) ? amount : 0;
}

export function formatAmount(value: number | string | null | undefined): string {
  return toAmount(value).toFixed(2);
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
