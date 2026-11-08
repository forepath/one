import type { WorkerFactory } from './graph-compute';

/**
 * Creates the layout worker (bundled by the application builder from the `new URL(…, import.meta.url)` pattern), or
 * `null` where workers are unavailable (the viewer then runs its jobs inline). Kept in its own module so unit tests
 * can replace it (`import.meta` is not available in the CommonJS test build).
 */
export function graphWorkerFactory(): WorkerFactory | null {
  if (typeof Worker === 'undefined') {
    return null;
  }

  return () => new Worker(new URL('./graph-layout.worker', import.meta.url), { type: 'module' });
}
