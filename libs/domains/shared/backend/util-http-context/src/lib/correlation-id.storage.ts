import { AsyncLocalStorage } from 'node:async_hooks';

const correlationIdStorage = new AsyncLocalStorage<string>();

/**
 * Runs `fn` with correlation id bound for async continuation (Node async_hooks).
 * Used by HTTP middleware so downstream async work can read the id via `getCorrelationId()`.
 */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return correlationIdStorage.run(correlationId, fn);
}

/** Returns the correlation id for the current async context, if any. */
export function getCorrelationId(): string | undefined {
  return correlationIdStorage.getStore();
}
