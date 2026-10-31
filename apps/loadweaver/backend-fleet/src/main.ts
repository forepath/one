import { installAppLogger } from './app-logger';

// JSON from the first line, before the app's modules load (3.43 live test: the control plane's first lines were text).
const logger = installAppLogger();

// Loaded lazily: the app's TypeORM configuration reads the database settings at import time.
import('./bootstrap')
  .then(async ({ bootstrap }) => await bootstrap())
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    logger.error(`Bootstrap failed: ${message}`, stack, 'Bootstrap');
    process.exit(1);
  });
