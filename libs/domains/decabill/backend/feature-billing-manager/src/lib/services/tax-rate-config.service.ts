import { Injectable } from '@nestjs/common';

import { TaxCategory } from '../constants/tax-category.constants';

export interface TaxRateResolver {
  resolveRate(taxCategory: TaxCategory): number;
}

@Injectable()
export class TaxRateConfigService implements TaxRateResolver {
  resolveRate(taxCategory: TaxCategory): number {
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
