import { TaxCategory } from '../constants/tax-category.constants';
import type { ServicePlanEntity } from '../entities/service-plan.entity';

export function resolvePlanTaxCategory(plan: Pick<ServicePlanEntity, 'taxCategory'>): TaxCategory {
  return plan.taxCategory ?? TaxCategory.STANDARD;
}
