import { TaxCategory } from '../../constants/tax-category.constants';
import { resolveProjectPricing } from '../../projects/utils/project-pricing.utils';
import type { LineItemInput } from '../../services/tax-calculation.service';
import { withoutInternalPricing } from '../../utils/internal-pricing-visibility.util';
import type { AdminOfferLineResponseDto, OfferProjectTemplateLineDto, OfferStandardLineDto } from '../dto/offer.dto';
import type { OfferLineItemEntity } from '../entities/offer-line-item.entity';

export function mapOfferStandardLineToTaxInput(payload: OfferStandardLineDto): LineItemInput {
  return {
    description: payload.description,
    quantity: payload.quantity,
    unitPriceNet: payload.unitPriceNet,
    taxCategory: payload.taxCategory ?? TaxCategory.STANDARD,
  };
}

/**
 * Offer pricing of a project template line: hourly projects are estimated as target hours (else 1) × hourly rate;
 * capped and fixed-price projects are offered at their maximum / fixed price (quantity 1).
 */
export function resolveOfferProjectTemplateLinePricing(payload: OfferProjectTemplateLineDto): {
  quantity: number;
  unitPriceNet: number;
  unitLabel: string | null;
} {
  const pricing = resolveProjectPricing(payload.pricingModel, payload.priceLimitNet);

  if (pricing.priceLimitNet != null) {
    return { quantity: 1, unitPriceNet: pricing.priceLimitNet, unitLabel: null };
  }

  const quantity = payload.targetHours != null && payload.targetHours > 0 ? payload.targetHours : 1;

  return { quantity, unitPriceNet: payload.hourlyRateNet, unitLabel: 'hour' };
}

export function mapOfferProjectTemplateLineToTaxInput(payload: OfferProjectTemplateLineDto): LineItemInput {
  const { quantity, unitPriceNet } = resolveOfferProjectTemplateLinePricing(payload);

  return {
    description: payload.description,
    quantity,
    unitPriceNet,
    taxCategory: TaxCategory.STANDARD,
  };
}

export function mapOfferPlanTemplateLineToTaxInput(
  preparedDescription: string,
  periodUnitPriceNet: number,
  taxCategory: TaxCategory = TaxCategory.STANDARD,
): LineItemInput {
  return {
    description: preparedDescription,
    quantity: 1,
    unitPriceNet: periodUnitPriceNet,
    taxCategory,
  };
}

export function buildOfferProjectTemplatePayload(payload: OfferProjectTemplateLineDto): Record<string, unknown> {
  return {
    name: payload.name,
    description: payload.projectDescription ?? null,
    hourlyRateNet: payload.hourlyRateNet,
    currency: payload.currency ?? 'EUR',
    targetHours: payload.targetHours ?? null,
    ...resolveProjectPricing(payload.pricingModel, payload.priceLimitNet),
  };
}

export function mapOfferLineItemToResponse(
  line: OfferLineItemEntity,
  options: { includeInternal?: boolean } = {},
): AdminOfferLineResponseDto {
  return {
    // Internal (admins only): the article of `article` lines and base price / margins in the pricing snapshot.
    ...(options.includeInternal ? { inventoryArticleId: line.inventoryArticleId ?? null } : {}),
    id: line.id,
    position: line.position,
    lineType: line.lineType,
    description: line.description,
    quantity: Number(line.quantity),
    unitLabel: line.unitLabel ?? null,
    unitPriceNet: Number(line.unitPriceNet),
    taxCategory: line.taxCategory,
    taxRate: Number(line.taxRate),
    lineNet: Number(line.lineNet),
    lineTax: Number(line.lineTax),
    lineGross: Number(line.lineGross),
    scheduledAt: line.scheduledAt?.toISOString() ?? null,
    fulfillmentStatus: line.fulfillmentStatus,
    planId: line.planId ?? null,
    planNameSnapshot: line.planNameSnapshot ?? null,
    projectTemplatePayload: line.projectTemplatePayload ?? null,
    pricingSnapshot: line.pricingSnapshot
      ? options.includeInternal
        ? line.pricingSnapshot
        : withoutInternalPricing(line.pricingSnapshot)
      : null,
    requestedConfig: line.effectiveConfigSnapshot ?? undefined,
    addonIds: line.addonIds ?? undefined,
    addonConfigs: line.addonConfigsSnapshot ?? undefined,
  };
}
