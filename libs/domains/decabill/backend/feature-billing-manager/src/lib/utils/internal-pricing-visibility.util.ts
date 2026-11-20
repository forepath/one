import { UserRole } from '@forepath/identity/backend';

import type { RequestWithUser } from './billing-access.utils';
import { getUserFromRequest } from './billing-access.utils';

/**
 * Commercial internals (provider base price, margins, per-period plan articles) are for administrators only.
 * Customers get final prices (`customerPrice`) computed by the server instead.
 */
export const INTERNAL_PRICING_KEYS = ['basePrice', 'marginPercent', 'marginFixed'] as const;

/** Admins and the static API key (full access) see internal pricing; customers and anonymous callers do not. */
export function canViewInternalPricing(req: RequestWithUser | undefined): boolean {
  if (!req) {
    return false;
  }

  const user = getUserFromRequest(req);

  return user.isApiKeyAuth || user.userRole === UserRole.ADMIN;
}

/** Shallow copy without the internal pricing keys (pricing snapshots, pricing previews). */
export function withoutInternalPricing<T extends Record<string, unknown>>(
  value: T,
): Omit<T, (typeof INTERNAL_PRICING_KEYS)[number]> {
  const copy: Record<string, unknown> = { ...value };

  for (const key of INTERNAL_PRICING_KEYS) {
    delete copy[key];
  }

  return copy as Omit<T, (typeof INTERNAL_PRICING_KEYS)[number]>;
}
