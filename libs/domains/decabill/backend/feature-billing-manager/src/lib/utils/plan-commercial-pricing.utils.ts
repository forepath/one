import type { TaxCategory } from '../constants/tax-category.constants';
import type { UpdateServicePlanDto } from '../dto/update-service-plan.dto';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { PlanCommercialPricingSnapshot } from '../queue/plan-price-migrate.payload';

import { resolvePlanTaxCategory } from './plan-tax.utils';

function normalizePriceField(value?: string | null): string {
  if (value == null || !String(value).trim()) {
    return '';
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return String(value).trim();
  }

  return parsed.toFixed(4);
}

export function snapshotCommercialPricing(plan: ServicePlanEntity): PlanCommercialPricingSnapshot {
  return {
    basePrice: plan.basePrice ?? null,
    marginPercent: plan.marginPercent ?? null,
    marginFixed: plan.marginFixed ?? null,
    taxCategory: resolvePlanTaxCategory(plan),
  };
}

/** True when the update payload changes base price, margins, or VAT category vs the stored plan. */
export function commercialPricingFieldsChanged(existing: ServicePlanEntity, dto: UpdateServicePlanDto): boolean {
  if (dto.basePrice !== undefined && normalizePriceField(dto.basePrice) !== normalizePriceField(existing.basePrice)) {
    return true;
  }

  if (
    dto.marginPercent !== undefined &&
    normalizePriceField(dto.marginPercent) !== normalizePriceField(existing.marginPercent)
  ) {
    return true;
  }

  if (
    dto.marginFixed !== undefined &&
    normalizePriceField(dto.marginFixed) !== normalizePriceField(existing.marginFixed)
  ) {
    return true;
  }

  if (dto.taxCategory !== undefined) {
    const next = dto.taxCategory as TaxCategory;

    if (next !== resolvePlanTaxCategory(existing)) {
      return true;
    }
  }

  return false;
}
