import type { AddonEntity } from '../entities/addon.entity';
import { BillingIntervalType, type ServicePlanEntity } from '../entities/service-plan.entity';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
/** Approximate month length used for rate conversion between intervals. */
const MS_PER_MONTH = 30 * MS_PER_DAY;
const MS_PER_YEAR = 365 * MS_PER_DAY;

function intervalToMs(type: BillingIntervalType, value: number): number {
  const safeValue = Math.max(1, value);

  switch (type) {
    case BillingIntervalType.HOUR:
      return safeValue * MS_PER_HOUR;
    case BillingIntervalType.DAY:
      return safeValue * MS_PER_DAY;
    case BillingIntervalType.MONTH:
      return safeValue * MS_PER_MONTH;
    case BillingIntervalType.YEAR:
      return safeValue * MS_PER_YEAR;
    default:
      return safeValue * MS_PER_MONTH;
  }
}

function parseNumeric(value?: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Converts an addon's base rate to the subscription plan's billing period.
 * Example: addon €10/month on a yearly plan → €120 (approx, 12× month).
 */
export function convertAddonPriceToPlanPeriod(
  addon: Pick<AddonEntity, 'basePrice' | 'priceIntervalType' | 'priceIntervalValue'>,
  plan: Pick<ServicePlanEntity, 'billingIntervalType' | 'billingIntervalValue'>,
): number {
  const basePrice = parseNumeric(addon.basePrice);

  if (basePrice <= 0) {
    return 0;
  }

  const addonIntervalType = addon.priceIntervalType ?? BillingIntervalType.MONTH;
  const addonIntervalValue = addon.priceIntervalValue ?? 1;
  const planIntervalType = plan.billingIntervalType as BillingIntervalType;
  const planIntervalValue = plan.billingIntervalValue;
  const addonMs = intervalToMs(addonIntervalType, addonIntervalValue);
  const planMs = intervalToMs(planIntervalType, planIntervalValue);

  if (addonMs <= 0) {
    return 0;
  }

  const converted = basePrice * (planMs / addonMs);

  return Math.round(converted * 100) / 100;
}

export function assertNonNegativeAddonPrice(basePrice: string | null | undefined): void {
  if (basePrice === undefined || basePrice === null || basePrice === '') {
    return;
  }

  const parsed = Number(basePrice);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Addon base price must be a non-negative number');
  }
}
