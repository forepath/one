import { recordSharedCounter } from '@forepath/shared/backend/util-otel/metrics';
import { ForbiddenException, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { getAuthenticationMethod } from './authentication-method';
import { isBullBoardRequestPath } from './bull-board-request-path';
import { isOtelMetricsRequestPath } from './otel-metrics-request-path';

/**
 * Comma-separated allowlist parsing (trim, lowercase, drop empties).
 * Intentionally matches {@link parseAllowedHosts} in `@forepath/shared/shared/util-network-address`;
 * duplicated here because this library is compiled with `rootDir` scoped to this package only.
 */
function parseCorsOriginAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }

  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function isUnsafeMethod(method: string | undefined): boolean {
  const m = String(method || '').toUpperCase();

  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
}

/**
 * SAML Assertion Consumer Service: the IdP's auto-submitted form POST is cross-site by design (Origin is the IdP or
 * `null`). The endpoint authenticates the message itself (XML signature, InResponseTo bound to an outstanding request,
 * single-use RelayState) and login CSRF is prevented by the PKCE-bound code exchange, so the Origin check is skipped
 * for exactly this route when SAML is the active method.
 */
function isSamlAssertionConsumerServicePost(req: Request, requestPath: string): boolean {
  if (String(req.method || '').toUpperCase() !== 'POST') {
    return false;
  }

  const path = requestPath.replace(/\/+$/, '');

  if (path !== '/api/auth/saml/acs' && path !== '/auth/saml/acs') {
    return false;
  }

  try {
    return getAuthenticationMethod() === 'saml';
  } catch {
    return false;
  }
}

/**
 * In production, always enforce. Outside production, enforce only when `CORS_ORIGIN` is set so local
 * dev can run with open CORS (`*`) without listing origins twice.
 */
function isOriginAllowlistEnforced(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return true;
  }

  return Boolean(process.env.CORS_ORIGIN?.trim());
}

/**
 * Defense-in-depth for bearer-token APIs: reject browser-originated mutation requests from unexpected origins.
 *
 * Notes:
 * - Only checks when the browser sends an `Origin` header (non-browser clients often do not).
 * - Only applies to unsafe methods; OPTIONS is ignored.
 * - Allowlist is derived from `CORS_ORIGIN` (comma-separated), parsed with the same rules as other allowlists.
 * - Literal `*` in `CORS_ORIGIN` allows any origin for this check.
 */
export function createOriginAllowlistMiddleware(
  logger: Logger,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, _res, next) => {
    const requestPath = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';

    if (
      isBullBoardRequestPath(requestPath) ||
      isOtelMetricsRequestPath(requestPath) ||
      isSamlAssertionConsumerServicePost(req, requestPath)
    ) {
      next();

      return;
    }

    if (!isOriginAllowlistEnforced()) {
      next();

      return;
    }

    if (!isUnsafeMethod(req.method)) {
      next();

      return;
    }

    const originHeader = req.headers.origin;

    if (!originHeader || typeof originHeader !== 'string') {
      next();

      return;
    }

    const allowlist = parseCorsOriginAllowlist(process.env.CORS_ORIGIN);

    if (allowlist.includes('*')) {
      next();

      return;
    }

    const normalizedOrigin = originHeader.trim().toLowerCase();

    if (allowlist.length === 0) {
      logger.warn(`Rejecting request with Origin=${originHeader} because CORS_ORIGIN is not configured`);
      recordSharedCounter('origin_allowlist.rejected_total');
      next(new ForbiddenException('Origin not allowed'));

      return;
    }

    if (allowlist.includes(normalizedOrigin)) {
      next();

      return;
    }

    logger.warn(`Rejecting request with Origin=${originHeader} (not in allowlist)`);
    recordSharedCounter('origin_allowlist.rejected_total');
    next(new ForbiddenException('Origin not allowed'));
  };
}
