import {
  computeLineTotalsFromRate,
  rateForTaxCategory,
  type PricingPreviewResponse,
  type TaxPreviewRates,
} from '@forepath/decabill/frontend/data-access-billing-console';

import {
  aggregatePricingTotalsSummaries,
  buildPricingTotalsSummary,
  type PricingTotalsSummary,
} from '../pricing-totals-summary/pricing-totals.util';
import type { OfferFormLineItem } from './admin-offer-form.util';

export type { PricingTotalsSummary };

export interface OfferLineTotals {
  net: number;
  tax: number;
  gross: number;
  taxRate: number;
}

export function toOfferLinePricingSummary(totals: OfferLineTotals | null): PricingTotalsSummary | null {
  if (!totals) {
    return null;
  }

  return buildPricingTotalsSummary({
    net: totals.net,
    tax: totals.tax,
    taxRate: totals.taxRate,
    gross: totals.gross,
  });
}

export function aggregateOfferDraftPricingSummaries(
  lineTotals: Array<OfferLineTotals | null>,
): PricingTotalsSummary | null {
  return aggregatePricingTotalsSummaries(lineTotals.map((totals) => toOfferLinePricingSummary(totals)));
}

export function computeStandardOfferLineTotals(
  line: Pick<OfferFormLineItem, 'quantity' | 'unitPriceNet' | 'taxCategory'>,
  taxRates: TaxPreviewRates,
): OfferLineTotals | null {
  const quantity = Number(line.quantity);
  const unitPriceNet = Number(line.unitPriceNet);

  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPriceNet) || unitPriceNet < 0) {
    return null;
  }

  const taxRate = rateForTaxCategory(taxRates, line.taxCategory === 'reduced' ? 'reduced' : 'standard');

  return computeLineTotalsFromRate(quantity, unitPriceNet, taxRate);
}

export function computeProjectTemplateOfferLineTotals(
  line: Pick<OfferFormLineItem, 'hourlyRateNet' | 'targetHours'>,
  taxRates: TaxPreviewRates,
): OfferLineTotals | null {
  const hourlyRateNet = Number(line.hourlyRateNet);

  if (!Number.isFinite(hourlyRateNet) || hourlyRateNet < 0) {
    return null;
  }

  const quantity = line.targetHours != null && line.targetHours > 0 ? Number(line.targetHours) : 1;

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  const taxRate = rateForTaxCategory(taxRates, 'standard');

  return computeLineTotalsFromRate(quantity, hourlyRateNet, taxRate);
}

export function computePlanTemplateOfferLineTotals(pricing: PricingPreviewResponse | null): OfferLineTotals | null {
  if (!pricing) {
    return null;
  }

  const net = Number(pricing.grandTotal ?? pricing.totalPrice);
  const tax = Number(pricing.taxTotal);
  const gross = Number(pricing.totalGross);
  const taxRate = Number(pricing.taxRate);

  if (
    !Number.isFinite(net) ||
    net < 0 ||
    !Number.isFinite(tax) ||
    tax < 0 ||
    !Number.isFinite(gross) ||
    gross < 0 ||
    !Number.isFinite(taxRate) ||
    taxRate < 0
  ) {
    return null;
  }

  return { net, tax, gross, taxRate };
}
