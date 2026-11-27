import { bootstrap } from './bootstrap';

bootstrap().catch((error: unknown) => {
  console.error('Failed to start communication API', error);
  process.exit(1);
});
