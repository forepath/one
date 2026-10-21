import { ContextApiClient, ContextApiError } from './context-api.client';

/**
 * Probe the context API before serving tools. Retries transient failures (manager restarting);
 * authentication errors fail immediately.
 */
export async function waitForContextApi(
  client: Pick<ContextApiClient, 'health'>,
  attempts = 3,
  delayMs = 1_000,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await client.health();

      return;
    } catch (error) {
      lastError = error;

      if (error instanceof ContextApiError && (error.status === 401 || error.status === 403)) {
        break;
      }

      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Agenstra context API is unavailable');
}
