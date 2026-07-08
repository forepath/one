import { TaxCategory } from '../constants/tax-category.constants';
import type { PricingResult } from '../services/pricing.service';
import type { TaxCalculationService } from '../services/tax-calculation.service';

export interface PricingPreviewWithTax extends PricingResult {
  taxTotal: number;
  totalGross: number;
  taxRate: number;
}

export function enrichPricingWithStandardTax(
  pricing: PricingResult,
  taxCalculationService: TaxCalculationService,
): PricingPreviewWithTax {
  const totals = taxCalculationService.computeLines([
    {
      description: 'Subscription period',
      quantity: 1,
      unitPriceNet: pricing.totalPrice,
      taxCategory: TaxCategory.STANDARD,
    },
  ]);

  return {
    ...pricing,
    taxTotal: totals.taxTotal,
    totalGross: totals.totalGross,
    taxRate: totals.lines[0]?.taxRate ?? 0,
  };
}
