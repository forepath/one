import { TaxCategory } from '../constants/tax-category.constants';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { PricingService } from '../services/pricing.service';
import { ProviderServerTypesService } from '../services/provider-server-types.service';
import type { TaxCalculationService } from '../services/tax-calculation.service';
import { normalizeStoredProviderDefaults } from './provider-env-defaults.utils';

/**
 * Resolves provider infrastructure monthly price for a server type id (slug/name).
 */
export async function resolveServerTypePriceMonthly(
  providerServerTypesService: ProviderServerTypesService,
  providerId: string | null | undefined,
  serverTypeId: string,
  providerDefaults?: Record<string, string>,
): Promise<number | null> {
  if (!providerId?.trim() || !serverTypeId?.trim()) return null;

  const types = await providerServerTypesService.getServerTypes(providerId.trim(), providerDefaults);
  const match = types.find((st) => st.id === serverTypeId.trim());

  if (!match || match.priceMonthly == null || !Number.isFinite(match.priceMonthly)) {
    return null;
  }

  return match.priceMonthly;
}

/**
 * Resolves the lowest monthly infrastructure price across allowed server types.
 */
export async function resolveLowestServerTypePriceMonthly(
  providerServerTypesService: ProviderServerTypesService,
  providerId: string | null | undefined,
  allowedServerTypes: string[],
  providerDefaults?: Record<string, string>,
): Promise<number | null> {
  if (!providerId?.trim() || !Array.isArray(allowedServerTypes) || allowedServerTypes.length === 0) {
    return null;
  }

  const types = await providerServerTypesService.getServerTypes(providerId.trim(), providerDefaults);
  const allowed = new Set(allowedServerTypes);
  let lowest: number | null = null;

  for (const st of types) {
    if (!allowed.has(st.id) || st.priceMonthly == null || !Number.isFinite(st.priceMonthly)) continue;

    if (lowest === null || st.priceMonthly < lowest) {
      lowest = st.priceMonthly;
    }
  }

  return lowest;
}

export const BILLING_BASE_PRICE_CONFIG_KEY = 'billingBasePrice';

/**
 * Builds the backorder `requestedConfigSnapshot` from customer input plus resolved
 * server-type pricing fields computed before availability checks.
 */
export function buildBackorderRequestedConfigSnapshot(
  sanitizedRequested: Record<string, unknown>,
  effectiveConfig: Record<string, unknown>,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = { ...sanitizedRequested };

  const serverType = effectiveConfig['serverType'];

  if (typeof serverType === 'string' && serverType.trim()) {
    snapshot.serverType = serverType.trim();
  }

  const billingBasePrice = extractBillingBasePriceOverride(effectiveConfig);

  if (billingBasePrice != null) {
    snapshot[BILLING_BASE_PRICE_CONFIG_KEY] = billingBasePrice;
  }

  return snapshot;
}

export interface SubscriptionItemBillingContext {
  configSnapshot?: Record<string, unknown>;
  serviceType?: {
    provider?: string | null;
    providerDefaults?: Record<string, string>;
  };
}

/**
 * Resolves per-subscription infrastructure base price from item snapshots, falling back to
 * live provider catalog lookup when only serverType was persisted (legacy orders).
 */
export async function resolveSubscriptionBillingBaseOverride(
  items: SubscriptionItemBillingContext[],
  providerServerTypesService: ProviderServerTypesService,
): Promise<number | undefined> {
  if (!items.length) {
    return undefined;
  }

  for (const item of items) {
    const fromSnapshot = extractBillingBasePriceOverride(item.configSnapshot);

    if (fromSnapshot != null) {
      return fromSnapshot;
    }
  }

  for (const item of items) {
    const serverType = item.configSnapshot?.['serverType'];

    if (typeof serverType !== 'string' || !serverType.trim()) {
      continue;
    }

    const provider = item.serviceType?.provider;
    const providerDefaults = normalizeStoredProviderDefaults(item.serviceType?.providerDefaults);
    const priceMonthly = await resolveServerTypePriceMonthly(
      providerServerTypesService,
      provider,
      serverType,
      providerDefaults,
    );

    if (priceMonthly != null) {
      return priceMonthly;
    }
  }

  return undefined;
}

/**
 * Resolves infrastructure base price from a config snapshot (e.g. backorder requested config).
 */
export async function resolveConfigSnapshotBillingBaseOverride(
  configSnapshot: Record<string, unknown> | undefined,
  serviceType: SubscriptionItemBillingContext['serviceType'] | undefined,
  providerServerTypesService: ProviderServerTypesService,
): Promise<number | undefined> {
  const fromSnapshot = extractBillingBasePriceOverride(configSnapshot);

  if (fromSnapshot != null) {
    return fromSnapshot;
  }

  const serverType = configSnapshot?.['serverType'];

  if (typeof serverType !== 'string' || !serverType.trim()) {
    return undefined;
  }

  const priceMonthly = await resolveServerTypePriceMonthly(
    providerServerTypesService,
    serviceType?.provider,
    serverType,
    normalizeStoredProviderDefaults(serviceType?.providerDefaults),
  );

  return priceMonthly ?? undefined;
}

/**
 * Resolves gross total price for one billing period (incl. standard VAT), using plan margin
 * rules and server-type overrides. Matches invoice and withdrawal refund tax treatment.
 */
export async function resolvePeriodTotalPrice(
  plan: ServicePlanEntity,
  pricingService: PricingService,
  taxCalculationService: TaxCalculationService,
  providerServerTypesService: ProviderServerTypesService,
  context: {
    items?: SubscriptionItemBillingContext[];
    configSnapshot?: Record<string, unknown>;
    serviceType?: SubscriptionItemBillingContext['serviceType'];
  },
): Promise<number> {
  let basePriceOverride: number | undefined;

  if (context.items?.length) {
    basePriceOverride = await resolveSubscriptionBillingBaseOverride(context.items, providerServerTypesService);
  } else {
    basePriceOverride = await resolveConfigSnapshotBillingBaseOverride(
      context.configSnapshot,
      context.serviceType,
      providerServerTypesService,
    );
  }

  const netPrice = pricingService.calculate(plan, basePriceOverride).totalPrice;

  return taxCalculationService.computeLines([
    {
      description: 'Subscription period',
      quantity: 1,
      unitPriceNet: netPrice,
      taxCategory: TaxCategory.STANDARD,
    },
  ]).totalGross;
}

export function extractBillingBasePriceOverride(
  configSnapshot: Record<string, unknown> | undefined,
): number | undefined {
  if (!configSnapshot) return undefined;

  const value = configSnapshot[BILLING_BASE_PRICE_CONFIG_KEY];

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}
