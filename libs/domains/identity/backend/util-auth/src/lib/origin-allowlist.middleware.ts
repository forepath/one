import { ForbiddenException, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { isBullBoardRequestPath } from './bull-board-request-path';

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

    if (isBullBoardRequestPath(requestPath)) {
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
      next(new ForbiddenException('Origin not allowed'));

      return;
    }

    if (allowlist.includes(normalizedOrigin)) {
      next();

      return;
    }

    logger.warn(`Rejecting request with Origin=${originHeader} (not in allowlist)`);
    next(new ForbiddenException('Origin not allowed'));
  };
}
