/** What a `ListenBackoff` logs through (a Nest `Logger`). */
export interface ListenBackoffLogger {
  log(message: string): void;
  warn(message: string): void;
  debug?(message: string): void;
}

export const LISTEN_BACKOFF_BASE_MS = 2_000;
export const LISTEN_BACKOFF_MAX_MS = 30_000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reconnect back-off of a dedicated LISTEN connection (live relay, desired-state notifications; 3.43 live test): while
 * the members' leader is gone (≈ 45 s until the read-only fallback) every reconnect failed and logged a line every 2 s.
 * Now the delay doubles up to `maxMs`, the loss is logged once (warn), retries only at debug level, and the recovery
 * once.
 */
export class ListenBackoff {
  private failures = 0;

  constructor(
    private readonly name: string,
    private readonly logger: ListenBackoffLogger,
    private readonly baseMs = LISTEN_BACKOFF_BASE_MS,
    private readonly maxMs = LISTEN_BACKOFF_MAX_MS,
  ) {}

  /** Failed attempts since the connection was last up. */
  get attempts(): number {
    return this.failures;
  }

  /** The connection dropped or a reconnect failed: the delay before the next attempt. */
  failed(error?: unknown): number {
    const reason = error === undefined ? '' : `: ${errorText(error)}`;

    if (this.failures === 0) this.logger.warn(`${this.name} lost${reason}; reconnecting with back-off`);
    else this.logger.debug?.(`${this.name}: reconnect attempt ${this.failures} failed${reason}`);

    const delay = Math.min(this.maxMs, this.baseMs * 2 ** Math.min(this.failures, 16));

    this.failures++;

    return delay;
  }

  /** LISTEN works (again): logs the recovery once after failures. */
  succeeded(): void {
    if (this.failures > 0) this.logger.log(`${this.name} restored after ${this.failures} failed attempt(s)`);

    this.failures = 0;
  }
}
