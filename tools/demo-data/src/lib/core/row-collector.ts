import { SqlRow, SqlScript } from './sql';

/**
 * Collects rows per table and renders them in a fixed, FK-safe order. Every table that receives
 * rows must be listed in `insertOrder`; this catches ordering mistakes before psql does.
 */
export class RowCollector {
  private readonly rows = new Map<string, SqlRow[]>();

  constructor(private readonly insertOrder: readonly string[]) {}

  add(table: string, row: SqlRow): SqlRow {
    this.bucket(table).push(row);

    return row;
  }

  addMany(table: string, rows: SqlRow[]): void {
    this.bucket(table).push(...rows);
  }

  /** Rows collected so far for `table` (mutable, e.g. to back-fill references). */
  rowsFor(table: string): SqlRow[] {
    return this.rows.get(table) ?? [];
  }

  /**
   * Orders rows by a date column (nulls last). Document numbers are allocated in insert order,
   * so sorting keeps numbers chronological.
   */
  sortByDate(table: string, column: string): void {
    const time = (row: SqlRow): number => {
      const value = row[column];

      return value instanceof Date ? value.getTime() : Number.POSITIVE_INFINITY;
    };

    this.rowsFor(table).sort((a, b) => time(a) - time(b));
  }

  count(table: string): number {
    return this.rows.get(table)?.length ?? 0;
  }

  get totalRows(): number {
    let total = 0;

    for (const rows of this.rows.values()) {
      total += rows.length;
    }

    return total;
  }

  /** Inserts every collected table into `script`; `conflictFor` may add `ON CONFLICT` clauses. */
  writeTo(script: SqlScript, conflictFor: (table: string) => string | undefined = () => undefined): void {
    for (const table of this.insertOrder) {
      const rows = this.rows.get(table);

      if (rows?.length) {
        script.comment(`${table}: ${rows.length} rows`);
        script.insert(table, rows, { onConflict: conflictFor(table) });
      }
    }
  }

  private bucket(table: string): SqlRow[] {
    if (!this.insertOrder.includes(table)) {
      throw new Error(`Table ${table} is missing from the insert order`);
    }

    let bucket = this.rows.get(table);

    if (!bucket) {
      bucket = [];
      this.rows.set(table, bucket);
    }

    return bucket;
  }
}
