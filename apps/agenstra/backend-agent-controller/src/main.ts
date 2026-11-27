import { bootstrap } from './bootstrap';

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error('Bootstrap failed:', message, stack ?? '');
  process.exit(1);
});
