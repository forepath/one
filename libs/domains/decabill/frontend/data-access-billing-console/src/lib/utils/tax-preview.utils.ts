import type { TaxCategory, TaxPreviewRates } from '../types/billing.types';

export function rateForTaxCategory(rates: TaxPreviewRates, taxCategory: TaxCategory = 'standard'): number {
  return taxCategory === 'reduced' ? rates.reduced : rates.standard;
}

export function computeLineTotalsFromRate(
  quantity: number,
  unitPriceNet: number,
  taxRate: number,
): { net: number; tax: number; gross: number; taxRate: number } {
  const net = Math.round(quantity * unitPriceNet * 100) / 100;
  const tax = Math.round(net * (taxRate / 100) * 100) / 100;
  const gross = Math.round((net + tax) * 100) / 100;

  return { net, tax, gross, taxRate };
}
