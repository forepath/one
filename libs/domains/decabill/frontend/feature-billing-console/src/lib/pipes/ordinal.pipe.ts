import { Pipe, PipeTransform } from '@angular/core';

/**
 * Transforms a number (1-28) into an ordinal string: 1st, 2nd, 3rd, 4th, etc.
 */
@Pipe({ name: 'ordinal', standalone: true })
export class OrdinalPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value == null || typeof value !== 'number') {
      return '';
    }

    const n = Math.floor(value);

    if (n < 1 || n > 31) {
      return String(n);
    }

    const mod10 = n % 10;
    const mod100 = n % 100;
    const suffix =
      mod10 === 1 && mod100 !== 11
        ? 'st'
        : mod10 === 2 && mod100 !== 12
          ? 'nd'
          : mod10 === 3 && mod100 !== 13
            ? 'rd'
            : 'th';

    return `${n}${suffix}`;
  }
}
