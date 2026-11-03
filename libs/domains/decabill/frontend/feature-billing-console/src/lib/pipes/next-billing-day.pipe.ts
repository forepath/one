import { Pipe, PipeTransform } from '@angular/core';

import { formatBillingDate } from '../billing-format';

/** Next occurrence of a billing day (1-28) from `now`; `null` outside 1-28. */
export function nextBillingDate(value: number, now: Date = new Date()): Date | null {
  const day = Math.floor(value);

  if (day < 1 || day > 28) {
    return null;
  }

  const currentDay = Math.min(now.getDate(), 28);

  return currentDay < day
    ? new Date(now.getFullYear(), now.getMonth(), day)
    : new Date(now.getFullYear(), now.getMonth() + 1, day);
}

/**
 * Transforms a billing day (1-28) into its next occurrence in the one table date format (DB-05): `Nov 28, 2026` /
 * `28.11.2026` (was a US-only long date with an ordinal, "November 28th, 2026").
 */
@Pipe({ name: 'nextBillingDay', standalone: true })
export class NextBillingDayPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value == null || typeof value !== 'number') {
      return '';
    }

    const next = nextBillingDate(value);

    return next ? formatBillingDate(next) : String(Math.floor(value));
  }
}
