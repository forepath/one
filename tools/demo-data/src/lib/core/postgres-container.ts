import { spawnSync } from 'child_process';

export interface PostgresContainerOptions {
  container: string;
  user: string;
  database: string;
}

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function runDocker(args: string[], input?: string): CommandResult {
  const result = spawnSync('docker', args, {
    input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Failed to run docker ${args[0]}: ${result.error.message}`);
  }

  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * Talks to a Postgres server running inside a compose container via `docker exec … psql`.
 * The compose files do not publish Postgres ports, so this is the only path that works with
 * a plain `start-containers` setup.
 */
export class PostgresContainer {
  constructor(private readonly options: PostgresContainerOptions) {}

  get label(): string {
    return `${this.options.container}/${this.options.database}`;
  }

  assertRunning(): void {
    const result = runDocker(['inspect', '--format', '{{.State.Running}}', this.options.container]);

    if (result.status !== 0 || result.stdout.trim() !== 'true') {
      throw new Error(
        `Container ${this.options.container} is not running. Start it with the app's start-containers target first.`,
      );
    }
  }

  /** Runs a script in a single transaction; any error rolls everything back. */
  execute(sql: string): void {
    const result = runDocker(
      [
        'exec',
        '-i',
        this.options.container,
        'psql',
        '-X',
        '-q',
        '-v',
        'ON_ERROR_STOP=1',
        '--single-transaction',
        '-U',
        this.options.user,
        '-d',
        this.options.database,
        '-f',
        '-',
      ],
      sql,
    );

    if (result.status !== 0) {
      throw new Error(`psql failed on ${this.label}:\n${result.stderr.trim() || result.stdout.trim()}`);
    }
  }

  /** Runs a read-only query and returns rows as arrays of column strings. */
  query(sql: string): string[][] {
    const result = runDocker([
      'exec',
      this.options.container,
      'psql',
      '-X',
      '-A',
      '-t',
      '-F',
      '\u001f',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      this.options.user,
      '-d',
      this.options.database,
      '-c',
      sql,
    ]);

    if (result.status !== 0) {
      throw new Error(`psql query failed on ${this.label}:\n${result.stderr.trim()}`);
    }

    return result.stdout
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => line.split('\u001f'));
  }

  /** Returns the subset of `tables` that do not exist (i.e. migrations have not run yet). */
  findMissingTables(tables: string[]): string[] {
    const list = tables.map((table) => `'${table.replace(/'/g, "''")}'`).join(', ');
    const existing = new Set(
      this.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${list})`,
      ).map(([name]) => name),
    );

    return tables.filter((table) => !existing.has(table));
  }
}
