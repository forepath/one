import { Injectable } from '@nestjs/common';

import { TaxCategory } from '../constants/tax-category.constants';
import { TaxMode } from '../constants/tax-mode.constants';
import { EU_VAT_RATES } from '../constants/eu-vat-rates.constants';
import { normalizeVatCountryCode } from '../constants/eu-member-states.constants';

export interface ResolveTaxRateParams {
  countryCode?: string | null;
  taxCategory: TaxCategory;
  taxMode: TaxMode;
  /** When true, non_eu_issuer_eu_b2b charges customer-country VAT instead of 0. */
  forceChargeNonEuIssuerEuB2b?: boolean;
}

const ZERO_RATE_MODES = new Set<TaxMode>([
  TaxMode.EU_REVERSE_CHARGE,
  TaxMode.THIRD_COUNTRY_B2B_NO_VAT,
  TaxMode.THIRD_COUNTRY_B2C_NO_DOMESTIC_VAT,
]);

@Injectable()
export class TaxRateConfigService {
  resolveRate(params: ResolveTaxRateParams | TaxCategory): number {
    // Legacy signature: resolveRate(taxCategory) used issuer env rates only.
    if (typeof params === 'string') {
      return this.resolveIssuerOverrideRate(params);
    }

    const { taxCategory, taxMode, forceChargeNonEuIssuerEuB2b } = params;

    if (ZERO_RATE_MODES.has(taxMode)) {
      return 0;
    }

    if (taxMode === TaxMode.NON_EU_ISSUER_EU_B2B && !forceChargeNonEuIssuerEuB2b) {
      return 0;
    }

    const countryCode = normalizeVatCountryCode(params.countryCode);
    const entry = countryCode ? EU_VAT_RATES[countryCode] : undefined;

    if (entry) {
      if (taxCategory === TaxCategory.REDUCED) {
        return entry.reduced ?? entry.standard;
      }

      return entry.standard;
    }

    // Issuer-country env override bridge when table entry is missing.
    return this.resolveIssuerOverrideRate(taxCategory);
  }

  resolveIssuerOverrideRate(taxCategory: TaxCategory): number {
    if (taxCategory === TaxCategory.REDUCED) {
      return this.parseRate(process.env.BILLING_TAX_RATE_REDUCED, 7);
    }

    return this.parseRate(process.env.BILLING_TAX_RATE_STANDARD, 19);
  }

  private parseRate(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw.trim() === '') {
      return fallback;
    }

    const parsed = Number(raw);

    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
}
