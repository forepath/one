import { bootstrap } from './bootstrap';

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start communication API', error);
  process.exit(1);
});
