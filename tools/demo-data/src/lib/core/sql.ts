export class SqlRaw {
  constructor(readonly sql: string) {}
}

export class SqlJson {
  constructor(readonly value: unknown) {}
}

export type SqlValue = string | number | boolean | null | undefined | Date | SqlRaw | SqlJson;

export type SqlRow = Record<string, SqlValue>;

/** Inlines a SQL expression (for example a function call) instead of a quoted literal. */
export function raw(sql: string): SqlRaw {
  return new SqlRaw(sql);
}

/** Serializes the value as a `jsonb` literal. */
export function json(value: unknown): SqlJson {
  return new SqlJson(value);
}

export function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  // standard_conforming_strings is on by default, so only single quotes need escaping.
  return `'${value.replace(/'/g, "''")}'`;
}

export function toSqlLiteral(value: SqlValue): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (value instanceof SqlRaw) {
    return value.sql;
  }

  if (value instanceof SqlJson) {
    return `${quoteLiteral(JSON.stringify(value.value))}::jsonb`;
  }

  if (value instanceof Date) {
    return quoteLiteral(value.toISOString());
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot encode non-finite number ${value} as SQL`);
    }

    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  return quoteLiteral(value);
}

export interface InsertOptions {
  /** Appended verbatim, e.g. `ON CONFLICT DO NOTHING`. */
  onConflict?: string;
  chunkSize?: number;
}

/**
 * Builds multi-row INSERT statements. Columns are the union of all row keys; a row that omits
 * a column (or sets it to `undefined`) gets the column DEFAULT.
 */
export function buildInsert(table: string, rows: SqlRow[], options: InsertOptions = {}): string[] {
  if (rows.length === 0) {
    return [];
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const chunkSize = options.chunkSize ?? 250;
  const statements: string[] = [];

  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const encodeCell = (row: SqlRow, column: string): string =>
      row[column] === undefined ? 'DEFAULT' : toSqlLiteral(row[column]);
    const values = chunk.map((row) => `(${columns.map((column) => encodeCell(row, column)).join(', ')})`).join(',\n  ');
    const conflict = options.onConflict ? `\n${options.onConflict}` : '';

    statements.push(
      `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES\n  ${values}${conflict};`,
    );
  }

  return statements;
}

/** Accumulates statements for a single psql run. */
export class SqlScript {
  private readonly statements: string[] = [];

  comment(text: string): this {
    this.statements.push(`\n-- ${text}`);

    return this;
  }

  add(statement: string): this {
    this.statements.push(statement.trim().endsWith(';') ? statement : `${statement};`);

    return this;
  }

  insert(table: string, rows: SqlRow[], options?: InsertOptions): this {
    this.statements.push(...buildInsert(table, rows, options));

    return this;
  }

  get isEmpty(): boolean {
    return this.statements.length === 0;
  }

  toString(): string {
    return `${this.statements.join('\n')}\n`;
  }
}
