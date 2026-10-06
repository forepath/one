import * as fs from 'fs';
import * as path from 'path';

import { DEMO_ID_LIKE_PATTERN } from './demo-ids';
import { PostgresContainer } from './postgres-container';
import { quoteIdent, SqlScript } from './sql';

export type DemoCommand = 'seed' | 'reset';

export interface SeederContext {
  workspaceRoot: string;
  /** Seed for the pseudo random generator. */
  seed: number;
  /** Build SQL but do not touch any database. */
  dryRun: boolean;
  /** When set, every generated SQL script is written to this directory. */
  sqlOutDir?: string;
  log: (message: string) => void;
}

export interface DemoDataSeeder {
  readonly product: string;
  seed(context: SeederContext): Promise<void>;
  reset(context: SeederContext): Promise<void>;
}

/**
 * Credentials printed after seeding. Keep in sync with the README; they are intentionally
 * public demo values and must never be used outside local demo environments.
 */
export const DEMO_PASSWORD = 'Demo-Passw0rd!';

/** Base32 TOTP secret used for every TOTP-enrolled demo account. */
export const DEMO_TOTP_SECRET = 'KRUGKIDROVUWG2ZAMJZG653OEBTG66BAJJ2W24DT';

/** Code whose bcrypt hash is stored as pending email confirmation / reset token. */
export const DEMO_EMAIL_CODE = 'DEMO42';

export interface DemoDeleteTarget {
  table: string;
  /** Column holding the demo id; defaults to `id`. */
  column?: string;
  /** Custom condition instead of `<column> LIKE demo pattern`. */
  where?: string;
}

/** SQL condition matching demo ids in `column`. */
export function demoIdCondition(column: string): string {
  return `${quoteIdent(column)}::text LIKE '${DEMO_ID_LIKE_PATTERN}'`;
}

/** DELETE statements for demo rows, in the given (child-first) order. */
export function buildDemoDeletes(targets: readonly DemoDeleteTarget[]): string[] {
  return targets.map(
    ({ table, column = 'id', where }) => `DELETE FROM ${quoteIdent(table)} WHERE ${where ?? demoIdCondition(column)};`,
  );
}

/** Writes the script (optional) and runs it unless this is a dry run. */
export function applyScript(
  context: SeederContext,
  database: PostgresContainer,
  script: SqlScript,
  fileName: string,
): void {
  const sql = script.toString();

  if (context.sqlOutDir) {
    const outDir = path.resolve(context.workspaceRoot, context.sqlOutDir);

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, fileName), sql, 'utf8');
    context.log(`Wrote ${path.join(outDir, fileName)}`);
  }

  if (context.dryRun) {
    context.log(`Dry run: skipped executing ${fileName} on ${database.label}`);

    return;
  }

  database.execute(sql);
  context.log(`Applied ${fileName} on ${database.label}`);
}
