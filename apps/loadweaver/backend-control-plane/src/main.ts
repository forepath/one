import { runDrToolCli } from '@forepath/loadweaver/backend/feature-control-plane';

function fail(prefix: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  // eslint-disable-next-line no-console -- runs before Nest logger is reliable
  console.error(prefix, message, stack ?? '');
  process.exit(1);
}

if (process.argv[2] === 'dr') {
  // Disaster recovery tool of a fresh node (3.20): run by `loadweaver-agent bootstrap --restore` as a one-shot
  // container of this image; no database, no HTTP server.
  runDrToolCli(process.argv[3] ?? '').catch((error: unknown) => fail('Disaster recovery failed:', error));
} else {
  // Loaded only here: the app's TypeORM configuration reads the database settings at import time.
  import('./bootstrap')
    .then(async ({ bootstrap }) => await bootstrap())
    .catch((error: unknown) => fail('Bootstrap failed:', error));
}
