import { createDemoId } from './demo-ids';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Seeded pseudo random generator (mulberry32). The same `--seed` produces the same data set,
 * which keeps demos and screenshots reproducible.
 */
export class DemoRandom {
  private state: number;

  constructor(
    seed: number,
    readonly now: Date = new Date(),
  ) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Decimal in [min, max] rounded to `decimals`. */
  decimal(min: number, max: number, decimals = 2): number {
    const factor = 10 ** decimals;

    return Math.round((min + this.next() * (max - min)) * factor) / factor;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from an empty list');
    }

    return items[Math.floor(this.next() * items.length)];
  }

  /** Picks `count` distinct items (or all items when the list is shorter). */
  pickMany<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, Math.min(count, items.length));
  }

  /**
   * Returns a picker that walks through all items (shuffled) before repeating, so every state
   * appears at least once as soon as the picker is called `items.length` times.
   */
  deck<T>(items: readonly T[]): () => T {
    let queue: T[] = [];

    return () => {
      if (queue.length === 0) {
        queue = this.shuffle(items);
      }

      return queue.shift() as T;
    };
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];

    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));

      [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
  }

  id(): string {
    return createDemoId(() => Math.floor(this.next() * 16));
  }

  hex(length: number): string {
    return Array.from({ length }, () => Math.floor(this.next() * 16).toString(16)).join('');
  }

  alphanumeric(length: number): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

    return Array.from({ length }, () => alphabet[Math.floor(this.next() * alphabet.length)]).join('');
  }

  daysAgo(days: number, jitterHours = 0): Date {
    return new Date(this.now.getTime() - days * DAY_MS - this.int(0, jitterHours) * 60 * 60 * 1000);
  }

  daysFromNow(days: number): Date {
    return new Date(this.now.getTime() + days * DAY_MS);
  }

  /** Random moment between `fromDaysAgo` and `toDaysAgo` days in the past. */
  pastDate(fromDaysAgo: number, toDaysAgo = 0): Date {
    const from = this.now.getTime() - fromDaysAgo * DAY_MS;
    const to = this.now.getTime() - toDaysAgo * DAY_MS;

    return new Date(from + this.next() * (to - from));
  }

  addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }

  addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * DAY_MS);
  }
}

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function roundMoney(value: number, decimals = 2): number {
  const factor = 10 ** decimals;

  return Math.round(value * factor) / factor;
}

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
