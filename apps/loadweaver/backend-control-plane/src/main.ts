import { prepareDatabaseTarget, runDrToolCli } from '@forepath/loadweaver/backend/feature-control-plane';

import { installAppLogger } from './app-logger';
import { databaseSsl } from './database-tls';

// JSON from the first line (3.43 live test: the database target step logged Nest's coloured text before bootstrap).
const logger = installAppLogger();

function fail(prefix: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  logger.error(`${prefix} ${message}`, stack, 'Bootstrap');
  process.exit(1);
}

if (process.argv[2] === 'dr') {
  // Disaster recovery tool of a fresh node (3.20): run by `loadweaver-agent bootstrap --restore` as a one-shot
  // container of this image; no database, no HTTP server.
  runDrToolCli(process.argv[3] ?? '').catch((error: unknown) => fail('Disaster recovery failed:', error));
} else {
  // Database handover (3.43): an external control plane may use the members' database (target file on the state
  // volume); decided before TypeORM reads the settings.
  Promise.resolve()
    .then(async () => await prepareDatabaseTarget(process.env, databaseSsl(process.env)))
    // Loaded only here: the app's TypeORM configuration reads the database settings at import time.
    .then(async () => await import('./bootstrap'))
    .then(async ({ bootstrap }) => await bootstrap())
    .catch((error: unknown) => fail('Bootstrap failed:', error));
}
