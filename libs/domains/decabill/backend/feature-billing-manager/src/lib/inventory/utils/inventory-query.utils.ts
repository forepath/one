import { INVENTORY_DEFAULT_PAGE_SIZE, INVENTORY_MAX_PAGE_SIZE } from '../constants/inventory.constants';

/** `%term%` for ILIKE with `%`, `_` and `\` escaped (search input is matched literally). */
export function inventoryLikeTerm(search: string): string {
  return `%${search.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Clamped `limit` / `offset` of an inventory list request. */
export function inventoryPage(limit?: number, offset?: number): { limit: number; offset: number } {
  const size =
    Number.isFinite(limit) && (limit as number) > 0 ? Math.floor(limit as number) : INVENTORY_DEFAULT_PAGE_SIZE;

  return {
    limit: Math.min(size, INVENTORY_MAX_PAGE_SIZE),
    offset: Number.isFinite(offset) && (offset as number) > 0 ? Math.floor(offset as number) : 0,
  };
}

/** Decimal column value (pg returns numeric as string) to number; null stays null. */
export function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

/** Rounds to the stored quantity scale (3 decimals) to avoid binary float drift in sums. */
export function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** `YYYY-MM-DD` of today (UTC), the reference for lending due dates. */
export function inventoryToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
