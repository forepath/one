import type { PublicServicePlanOffering } from '../types/portal-service-plans.types';

export interface PublicOfferingPriceDisplay {
  prefix: string;
  amount: number;
}

export function formatPublicOfferingPrice(plan: PublicServicePlanOffering): PublicOfferingPriceDisplay {
  if (plan.allowCustomerServerTypeSelection && plan.totalPriceFrom != null && plan.totalPriceFrom < plan.totalPrice) {
    return { prefix: 'from ', amount: plan.totalPriceFrom };
  }

  return { prefix: '', amount: plan.totalPrice };
}
