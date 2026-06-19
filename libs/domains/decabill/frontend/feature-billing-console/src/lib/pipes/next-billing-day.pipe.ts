import { Pipe, PipeTransform } from '@angular/core';

function ordinalSuffix(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;

  if (mod10 === 1 && mod100 !== 11) return 'st';

  if (mod10 === 2 && mod100 !== 12) return 'nd';

  if (mod10 === 3 && mod100 !== 13) return 'rd';

  return 'th';
}

/**
 * Transforms a billing day (1-28) into the next occurrence as a label in US format, e.g. "March 28th, 2026".
 */
@Pipe({ name: 'nextBillingDay', standalone: true })
export class NextBillingDayPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value == null || typeof value !== 'number') {
      return '';
    }

    const day = Math.floor(value);

    if (day < 1 || day > 28) {
      return String(day);
    }

    const now = new Date();
    const currentDay = Math.min(now.getDate(), 28);
    const next =
      currentDay < day
        ? new Date(now.getFullYear(), now.getMonth(), day)
        : new Date(now.getFullYear(), now.getMonth() + 1, day);
    const monthName = next.toLocaleDateString('en-US', { month: 'long' });

    return `${monthName} ${day}${ordinalSuffix(day)}, ${next.getFullYear()}`;
  }
}
