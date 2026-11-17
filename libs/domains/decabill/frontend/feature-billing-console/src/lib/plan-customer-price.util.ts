import type { ServerType, ServicePlanResponse } from '@forepath/decabill/frontend/data-access-billing-console';

function toNumber(value: string | number | null | undefined): number {
  if (value === undefined || value === null) return 0;

  const parsed = typeof value === 'number' ? value : Number(String(value).trim());

  return Number.isFinite(parsed) ? parsed : 0;
}

const positiveOrNull = (value: number): number | null => (value > 0 ? value : null);

/**
 * Final net plan price shown when ordering / changing a plan. Customers receive server-computed prices only
 * (`serverType.customerPrice` for a chosen server type, else `plan.customerPrice`); base prices and margins are
 * internal. The local formula (same as the backend PricingService) remains as fallback for admin-shaped responses.
 */
export function resolvePlanCustomerPrice(plan: ServicePlanResponse, serverType?: ServerType | null): number | null {
  if (serverType?.customerPrice != null && Number.isFinite(serverType.customerPrice)) {
    return positiveOrNull(serverType.customerPrice);
  }

  const typeBase = serverType?.priceMonthly;
  const hasTypeBase = typeBase != null && Number.isFinite(typeBase);

  if (!hasTypeBase && plan.customerPrice != null && Number.isFinite(plan.customerPrice)) {
    return positiveOrNull(plan.customerPrice);
  }

  const base = hasTypeBase ? (typeBase as number) : toNumber(plan.basePrice);

  if (base <= 0) return null;

  return base + base * (toNumber(plan.marginPercent) / 100) + toNumber(plan.marginFixed);
}
