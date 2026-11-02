import { execFileSync } from 'node:child_process';

import { CONTAINER_ENV } from './postgres.container';

/**
 * Drops the test file's own database when the file is done (integration-env.ts created it), so the throwaway
 * Postgres (memory-limited, data on tmpfs) holds one suite's data at a time.
 */
afterAll(() => {
  const container = process.env[CONTAINER_ENV];
  const database = process.env['DB_DATABASE'];

  if (!container || !database?.startsWith('it_')) return;

  try {
    execFileSync(
      'docker',
      ['exec', container, 'psql', '-U', 'postgres', '-qc', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`],
      { stdio: 'pipe' },
    );
  } catch {
    // Best effort: the container goes away with the run anyway.
  }
});
