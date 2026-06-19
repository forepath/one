import type { NextFunction, Request, Response } from 'express';

import './express-request-augmentation';
import { runWithTenantId } from './tenant-id.storage';
import { TENANT_ID_HEADER, parseConfiguredTenants, resolveTenantIdFromHeader } from './tenant-id.config';

function readIncomingTenantId(req: Request): string | undefined {
  const raw = req.headers[TENANT_ID_HEADER];
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;

  return resolveTenantIdFromHeader(value, parseConfiguredTenants());
}

/**
 * - Reads `X-Tenant` header (defaults to `default` when missing/blank).
 * - Rejects unknown or malformed tenant ids with `400`.
 * - Sets `req.tenantId` and binds AsyncLocalStorage for `getTenantId()` during the request.
 *
 * Install after correlation middleware on billing HTTP apps.
 */
export function createTenantIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const tenantId = readIncomingTenantId(req);

    if (!tenantId) {
      res.status(400).json({ message: 'Invalid or unknown tenant' });
      return;
    }

    req.tenantId = tenantId;
    runWithTenantId(tenantId, () => next());
  };
}
