import { inject, LOCALE_ID, Pipe, PipeTransform } from '@angular/core';

import {
  FpcDateInput,
  FpcDateRangeLabels,
  FpcDurationUnit,
  FpcMoneyOptions,
  fpcFormatDate,
  fpcFormatDateRange,
  fpcFormatDateTime,
  fpcFormatDuration,
  fpcFormatMoney,
  fpcFormatRelative,
  fpcFormatTime,
} from './format';

/**
 * `{{ amount | fpcMoney: currency }}` → `€65,059.45` / `65.059,45 €` (2 decimals, locale grouping and symbol).
 * Unit prices: `{{ price | fpcMoney: currency : { unitPrice: true } }}` (`€0.004`); chart-like cells:
 * `{ compact: true }` (`€25K`).
 */
@Pipe({ name: 'fpcMoney', standalone: true })
export class FpcMoneyPipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);

  transform(
    value: number | string | null | undefined,
    currency?: string | null,
    options: FpcMoneyOptions = {},
  ): string {
    return fpcFormatMoney(value, currency, this.locale, options);
  }
}

/**
 * The one table date / date-time: `{{ at | fpcDate }}` → `Oct 29, 2026`; `{{ at | fpcDate: 'datetime' }}` →
 * `Oct 29, 2026, 10:05 AM` (never seconds); `'time'` → `10:05 AM`; `'relative'` → `2 hr. ago` (feeds, falls back to
 * the date after a week). Second argument: fallback for empty values (e.g. `'—'`).
 */
@Pipe({ name: 'fpcDate', standalone: true })
export class FpcDatePipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);

  transform(value: FpcDateInput, format: 'date' | 'datetime' | 'time' | 'relative' = 'date', fallback = ''): string {
    switch (format) {
      case 'datetime':
        return fpcFormatDateTime(value, this.locale, fallback);
      case 'time':
        return fpcFormatTime(value, this.locale, fallback);
      case 'relative':
        return fpcFormatRelative(value, this.locale, { fallback });
      default:
        return fpcFormatDate(value, this.locale, fallback);
    }
  }
}

/**
 * `{{ start | fpcDateRange: end }}` → `Oct 9 – Dec 31, 2026`; open end → `from Oct 29, 2026` (pass translated
 * `labels`, `{date}` placeholder). `withTime` adds the time (no seconds).
 */
@Pipe({ name: 'fpcDateRange', standalone: true })
export class FpcDateRangePipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);

  transform(
    start: FpcDateInput,
    end: FpcDateInput,
    options: { withTime?: boolean; labels?: FpcDateRangeLabels; fallback?: string } = {},
  ): string {
    return fpcFormatDateRange(start, end, this.locale, options);
  }
}

/** `{{ 3 | fpcDuration: 'month' }}` → `3 months` / `3 Monate` (real plural forms, platform-translated). */
@Pipe({ name: 'fpcDuration', standalone: true })
export class FpcDurationPipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);

  transform(count: number | null | undefined, unit: FpcDurationUnit, fallback = ''): string {
    return fpcFormatDuration(count, unit, this.locale, fallback);
  }
}
