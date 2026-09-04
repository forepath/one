import {
  computeLineTotalsFromRate,
  rateForTaxCategory,
  type PricingPreviewResponse,
  type TaxPreviewRates,
} from '@forepath/decabill/frontend/data-access-billing-console';

import type { OfferFormLineItem } from './admin-offer-form.util';

export interface OfferLineTotals {
  net: number;
  tax: number;
  gross: number;
  taxRate: number;
}

export function formatOfferPrice(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatOfferLineItemTotal(totals: OfferLineTotals | null): string {
  if (!totals) {
    return '—';
  }

  return `€${formatOfferPrice(totals.net)} + €${formatOfferPrice(totals.tax)} VAT (${totals.taxRate}%) = €${formatOfferPrice(totals.gross)}`;
}

export function formatOfferDraftTotals(totals: { net: number; tax: number; gross: number } | null): string {
  if (!totals) {
    return '—';
  }

  return `€${formatOfferPrice(totals.net)} net + €${formatOfferPrice(totals.tax)} VAT = €${formatOfferPrice(totals.gross)} gross`;
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

export function aggregateOfferDraftTotals(lineTotals: Array<OfferLineTotals | null>): {
  net: number;
  tax: number;
  gross: number;
} | null {
  let net = 0;
  let tax = 0;

  for (const lineTotal of lineTotals) {
    if (!lineTotal) {
      return null;
    }

    net += lineTotal.net;
    tax += lineTotal.tax;
  }

  return {
    net: Math.round(net * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    gross: Math.round((net + tax) * 100) / 100,
  };
}
