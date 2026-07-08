import { BillingIntervalType, ServicePlanOrderingHighlight } from '../entities/service-plan.entity';

import { WithdrawalPolicyDto } from './withdrawal-policy.dto';

/** Safe subset of a service plan for public marketing / external card UIs. */
export class PublicServicePlanOfferingDto {
  id!: string;
  name!: string;
  description!: string | null;
  serviceTypeId!: string;
  serviceTypeName!: string;
  billingIntervalType!: BillingIntervalType;
  billingIntervalValue!: number;
  /** Customer-facing total (base + margin); margin breakdown is not exposed. */
  totalPrice!: number;
  /** Lowest customer total across allowed server types when allowCustomerServerTypeSelection is true. */
  totalPriceFrom?: number;
  orderingHighlights!: ServicePlanOrderingHighlight[];
  /** When true, checkout UIs may offer region/location selection for this plan. */
  allowCustomerLocationSelection!: boolean;
  /** When true, checkout UIs may offer server type selection from allowed types. */
  allowCustomerServerTypeSelection!: boolean;
  withdrawalPolicy!: WithdrawalPolicyDto;
}
