import { TaxCategory } from '../../constants/tax-category.constants';
import type { LineItemInput } from '../../services/tax-calculation.service';
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

export function mapOfferProjectTemplateLineToTaxInput(payload: OfferProjectTemplateLineDto): LineItemInput {
  const quantity = payload.targetHours != null && payload.targetHours > 0 ? payload.targetHours : 1;

  return {
    description: payload.description,
    quantity,
    unitPriceNet: payload.hourlyRateNet,
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
  };
}

export function mapOfferLineItemToResponse(line: OfferLineItemEntity): AdminOfferLineResponseDto {
  return {
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
    pricingSnapshot: line.pricingSnapshot ?? null,
    requestedConfig: line.effectiveConfigSnapshot ?? undefined,
    addonIds: line.addonIds ?? undefined,
    addonConfigs: line.addonConfigsSnapshot ?? undefined,
  };
}
