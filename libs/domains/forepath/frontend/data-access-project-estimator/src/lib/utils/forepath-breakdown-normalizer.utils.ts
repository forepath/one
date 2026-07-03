import { FOREPATH_SERVICE_IDS } from '../constants/forepath-service-catalog.constants';
import type { ForepathServiceId, ProjectBreakdown, ProjectBreakdownLineItem } from '../types/project-estimator.types';

const SERVICE_ORDER = new Map<ForepathServiceId, number>(
  FOREPATH_SERVICE_IDS.map((serviceId, index) => [serviceId, index]),
);

function roundBillingUnits(units: number): number {
  return Math.max(4, Math.round(units / 4) * 4);
}

function roundQuantity(quantity: number): number {
  return Math.max(1, Math.round(quantity));
}

function compareLineItems(left: ProjectBreakdownLineItem, right: ProjectBreakdownLineItem): number {
  const leftOrder = SERVICE_ORDER.get(left.serviceId) ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = SERVICE_ORDER.get(right.serviceId) ?? Number.MAX_SAFE_INTEGER;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return left.description.localeCompare(right.description);
}

function normalizeLineItem(item: ProjectBreakdownLineItem): ProjectBreakdownLineItem {
  const normalized: ProjectBreakdownLineItem = {
    serviceId: item.serviceId,
    description: item.description.trim(),
    rateTier: item.rateTier,
  };

  if (item.billingUnits !== undefined) {
    normalized.billingUnits = roundBillingUnits(item.billingUnits);
  }

  if (item.quantity !== undefined) {
    normalized.quantity = roundQuantity(item.quantity);
  }

  return normalized;
}

export function normalizeProjectBreakdown(breakdown: ProjectBreakdown): ProjectBreakdown {
  return {
    summary: breakdown.summary.trim(),
    lineItems: breakdown.lineItems.map(normalizeLineItem).sort(compareLineItems),
    assumptions: breakdown.assumptions
      .map((assumption) => assumption.trim())
      .filter((assumption) => assumption.length > 0),
    confidence: breakdown.confidence,
  };
}
