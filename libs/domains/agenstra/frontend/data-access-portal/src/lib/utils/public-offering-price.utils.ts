import type { PublicServicePlanOffering } from '../types/portal-service-plans.types';

export interface PublicOfferingPriceDisplay {
  prefix: string;
  amount: number;
}

export function formatPublicOfferingPrice(plan: PublicServicePlanOffering): PublicOfferingPriceDisplay {
  if (plan.allowCustomerServerTypeSelection && plan.totalGrossFrom != null && plan.totalGrossFrom < plan.totalGross) {
    return { prefix: 'from ', amount: plan.totalGrossFrom };
  }

  return { prefix: '', amount: plan.totalGross };
}
