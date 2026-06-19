import { Injectable } from '@nestjs/common';

import { ServicePlanEntity } from '../entities/service-plan.entity';

export interface PricingResult {
  basePrice: number;
  marginPercent: number;
  marginFixed: number;
  totalPrice: number;
}

@Injectable()
export class PricingService {
  calculate(plan: ServicePlanEntity, basePriceOverride?: number): PricingResult {
    const basePrice = basePriceOverride ?? this.parseNumeric(plan.basePrice);
    const marginPercent = this.parseNumeric(plan.marginPercent);
    const marginFixed = this.parseNumeric(plan.marginFixed);
    const totalPrice = basePrice + basePrice * (marginPercent / 100) + marginFixed;

    return {
      basePrice,
      marginPercent,
      marginFixed,
      totalPrice,
    };
  }

  private parseNumeric(value?: string): number {
    if (!value) {
      return 0;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }
}
