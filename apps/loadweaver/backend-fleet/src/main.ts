// Loaded lazily: the app's TypeORM configuration reads the database settings at import time.
import('./bootstrap')
  .then(async ({ bootstrap }) => await bootstrap())
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    // eslint-disable-next-line no-console -- runs before the Nest logger is reliable
    console.error('Bootstrap failed:', message, stack ?? '');
    process.exit(1);
  });
