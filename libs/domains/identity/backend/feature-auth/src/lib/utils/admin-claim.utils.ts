import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Opt-in one-time admin claim for `users` authentication (`ADMIN_CLAIM_TOKEN_SHA256`, 64 hex characters): while no
 * account exists, the registration that would create the first account (the administrator) must present the token
 * whose SHA-256 is configured. Unset (the default) keeps the plain behaviour (the first registration becomes admin).
 * Once an account exists, the token is never consulted again and registration is closed (as with `DISABLE_SIGNUP`):
 * the claimed administrator creates or invites further users.
 * Used by Loadweaver Cloud so whoever finds a freshly provisioned public console first can't take the cluster over.
 */
export const ADMIN_CLAIM_TOKEN_SHA256_ENV = 'ADMIN_CLAIM_TOKEN_SHA256';

const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface AdminClaimConfig {
  /** True when `ADMIN_CLAIM_TOKEN_SHA256` is set (even if malformed: then no token matches, fail closed). */
  configured: boolean;
  hash: Buffer | null;
}

export function resolveAdminClaimConfig(env: NodeJS.ProcessEnv = process.env): AdminClaimConfig {
  const raw = env[ADMIN_CLAIM_TOKEN_SHA256_ENV]?.trim().toLowerCase();

  if (!raw) {
    return { configured: false, hash: null };
  }

  return { configured: true, hash: SHA256_HEX.test(raw) ? Buffer.from(raw, 'hex') : null };
}

/** Constant-time comparison of the presented token's SHA-256 with the configured hash. */
export function adminClaimTokenMatches(token: string | undefined, hash: Buffer | null): boolean {
  if (!hash || typeof token !== 'string' || !token) {
    return false;
  }

  const presented = createHash('sha256').update(token.trim(), 'utf8').digest();

  return presented.length === hash.length && timingSafeEqual(presented, hash);
}

/**
 * Failed-claim limiter per client (in memory, per API instance): after `maxFailures` wrong tokens within `windowMs`
 * the client is refused until the window ends. Complements the global request throttler without changing the
 * register route's limits for deployments that don't use the claim.
 */
export class AdminClaimAttemptLimiter {
  private readonly failures = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 15 * 60_000,
  ) {}

  isBlocked(key: string, now = Date.now()): boolean {
    const entry = this.failures.get(key);

    if (!entry) return false;

    if (now - entry.windowStart >= this.windowMs) {
      this.failures.delete(key);

      return false;
    }

    return entry.count >= this.maxFailures;
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.failures.get(key);

    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.failures.set(key, { count: 1, windowStart: now });
    } else {
      entry.count += 1;
    }

    if (this.failures.size > 10_000) {
      for (const [k, v] of this.failures) {
        if (now - v.windowStart >= this.windowMs) this.failures.delete(k);
      }
    }
  }
}
