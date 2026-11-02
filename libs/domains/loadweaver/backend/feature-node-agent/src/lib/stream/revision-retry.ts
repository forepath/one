/** First delay before a failed revision is applied again (live test 3.43). */
export const RETRY_INITIAL_MS = 15_000;
/** The delay doubles per failed attempt up to this cap. */
export const RETRY_MAX_MS = 5 * 60_000;
/** A failed retry whose outcome didn't change is reported only every this many attempts (no report spam). */
export const RETRY_REPORT_EVERY = 5;

/**
 * Backoff timer for re-applying a desired state that failed or rolled back (live test 3.43: a briefly unpullable
 * image kept the node on its previous revision until the control plane compiled a new one). One attempt is pending at
 * most; `reset` cancels it and starts the backoff over (success, a new revision, shutdown).
 */
export class RevisionRetry {
  private timer: NodeJS.Timeout | null = null;
  private baseMs = RETRY_INITIAL_MS;
  private count = 0;

  constructor(private readonly random: () => number = Math.random) {}

  /** Attempts started since the last reset. */
  get attempts(): number {
    return this.count;
  }

  get pending(): boolean {
    return this.timer !== null;
  }

  /** Runs `attempt` after the next backoff delay (jitter: 75–100 % of it), replacing a pending one; returns the delay. */
  schedule(attempt: () => void): number {
    this.cancel();

    const delay = Math.round(this.baseMs * (0.75 + this.random() / 4));

    this.baseMs = Math.min(this.baseMs * 2, RETRY_MAX_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.count++;
      attempt();
    }, delay);
    this.timer.unref?.();

    return delay;
  }

  reset(): void {
    this.cancel();
    this.baseMs = RETRY_INITIAL_MS;
    this.count = 0;
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);

    this.timer = null;
  }
}
