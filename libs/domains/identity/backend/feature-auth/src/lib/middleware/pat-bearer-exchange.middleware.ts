import { createHash } from 'node:crypto';

import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NestMiddleware,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { IDENTITY_RAW_PAT_BEARER_PATHS, PAT_LOOKUP_PREFIX_LENGTH, PAT_TOKEN_PREFIX } from '../constants/pat.constants';
import { AuthService } from '../services/auth.service';

/** How long an exchanged PAT JWT is reused for the same raw token (revocation is enforced live on every request). */
export const RAW_PAT_EXCHANGE_CACHE_TTL_MS = 60_000;

/** Upper bound of cached exchanges (oldest entries are evicted first). */
export const RAW_PAT_EXCHANGE_CACHE_MAX_ENTRIES = 1_000;

/** Failed raw PAT exchanges allowed per client address and window before further attempts are rejected (429). */
export const RAW_PAT_EXCHANGE_MAX_FAILURES = 10;

export const RAW_PAT_EXCHANGE_FAILURE_WINDOW_MS = 60_000;

interface CachedExchange {
  accessToken: string;
  expiresAt: number;
}

interface FailureWindow {
  count: number;
  resetAt: number;
}

/**
 * Accepts a raw personal access token (`Authorization: Bearer fp_pat_…`) on product-selected routes by exchanging it
 * for the regular PAT JWT (`amr: pat`) before the authentication guards run - exactly what `POST /auth/token` returns.
 * Every guard, live session check (revocation, expiry, scope changes, role demotion, lock) and `@RequireScopes`
 * enforcement therefore applies unchanged. Meant for integrations whose clients only support a static API key
 * (e.g. OpenAI-compatible SDKs).
 *
 * - Only paths matching {@link IDENTITY_RAW_PAT_BEARER_PATHS} are touched; everywhere else raw PATs stay rejected.
 * - Exchanges are cached for {@link RAW_PAT_EXCHANGE_CACHE_TTL_MS} by token hash (bcrypt runs at most once per token
 *   and window); concurrent requests share one exchange.
 * - Failed exchanges are counted per client address; above {@link RAW_PAT_EXCHANGE_MAX_FAILURES} per window further
 *   raw PAT attempts are rejected with 429 without running bcrypt (brute force / CPU exhaustion).
 * - An invalid token leaves the header untouched, so the guards reject the request with their usual 401.
 */
@Injectable()
export class PatBearerExchangeMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PatBearerExchangeMiddleware.name);
  private readonly cache = new Map<string, CachedExchange>();
  private readonly inFlight = new Map<string, Promise<string | null>>();
  private readonly failures = new Map<string, FailureWindow>();

  constructor(
    private readonly authService: AuthService,
    @Optional() @Inject(IDENTITY_RAW_PAT_BEARER_PATHS) private readonly paths: readonly RegExp[] = [],
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      await this.exchangeIfApplicable(req);
      next();
    } catch (error) {
      next(error);
    }
  }

  private async exchangeIfApplicable(req: Request): Promise<void> {
    const token = this.extractRawPat(req);

    if (!token || !this.matchesPath(req)) {
      return;
    }

    const now = Date.now();
    const key = createHash('sha256').update(token).digest('hex');
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > now) {
      req.headers.authorization = `Bearer ${cached.accessToken}`;

      return;
    }

    if (cached) {
      this.cache.delete(key);
    }

    const clientKey = req.ip || req.socket?.remoteAddress || 'unknown';

    if (this.isBlocked(clientKey, now)) {
      throw new HttpException('Too many invalid personal access token attempts', HttpStatus.TOO_MANY_REQUESTS);
    }

    let pending = this.inFlight.get(key);

    if (!pending) {
      pending = this.exchange(token, key).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }

    const accessToken = await pending;

    if (!accessToken) {
      this.recordFailure(clientKey, Date.now());

      return;
    }

    req.headers.authorization = `Bearer ${accessToken}`;
  }

  /** Resolves the exchanged JWT, or null when the token is invalid (the guards then reject the request). */
  private async exchange(token: string, key: string): Promise<string | null> {
    try {
      const { access_token: accessToken } = await this.authService.exchangePat(token);

      this.remember(key, accessToken);

      return accessToken;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        return null;
      }

      this.logger.warn(`Raw personal access token exchange failed: ${(error as Error).message}`);
      throw error;
    }
  }

  private remember(key: string, accessToken: string): void {
    while (this.cache.size >= RAW_PAT_EXCHANGE_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.cache.delete(oldest);
    }

    this.cache.set(key, { accessToken, expiresAt: Date.now() + RAW_PAT_EXCHANGE_CACHE_TTL_MS });
  }

  private isBlocked(clientKey: string, now: number): boolean {
    const window = this.failures.get(clientKey);

    if (!window) {
      return false;
    }

    if (window.resetAt <= now) {
      this.failures.delete(clientKey);

      return false;
    }

    return window.count >= RAW_PAT_EXCHANGE_MAX_FAILURES;
  }

  private recordFailure(clientKey: string, now: number): void {
    const window = this.failures.get(clientKey);

    if (!window || window.resetAt <= now) {
      // Bound memory: drop expired windows before adding a new one.
      if (this.failures.size >= RAW_PAT_EXCHANGE_CACHE_MAX_ENTRIES) {
        for (const [entryKey, entry] of this.failures) {
          if (entry.resetAt <= now) {
            this.failures.delete(entryKey);
          }
        }

        if (this.failures.size >= RAW_PAT_EXCHANGE_CACHE_MAX_ENTRIES) {
          const oldest = this.failures.keys().next().value;

          if (oldest !== undefined) {
            this.failures.delete(oldest);
          }
        }
      }

      this.failures.set(clientKey, { count: 1, resetAt: now + RAW_PAT_EXCHANGE_FAILURE_WINDOW_MS });

      return;
    }

    window.count += 1;
  }

  private matchesPath(req: Request): boolean {
    if (this.paths.length === 0) {
      return false;
    }

    const rawUrl: unknown = req.originalUrl ?? req.url;
    const path = typeof rawUrl === 'string' ? (rawUrl.split('?')[0] ?? '') : '';

    return this.paths.some((pattern) => {
      // Global / sticky patterns keep state between calls.
      pattern.lastIndex = 0;

      return pattern.test(path);
    });
  }

  private extractRawPat(req: Request): string | undefined {
    const header = req.headers.authorization;

    if (typeof header !== 'string') {
      return undefined;
    }

    const [scheme, token, ...rest] = header.split(' ');

    if (scheme !== 'Bearer' || !token || rest.length > 0) {
      return undefined;
    }

    if (!token.startsWith(PAT_TOKEN_PREFIX) || token.length < PAT_LOOKUP_PREFIX_LENGTH) {
      return undefined;
    }

    return token;
  }
}
