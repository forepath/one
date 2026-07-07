/** Matches {@link PublicServicePlanOfferingDto} from the billing API. */

export type BillingIntervalType = 'hour' | 'day' | 'month';

export interface ServicePlanOrderingHighlight {
  icon: string;
  text: string;
}

export interface WithdrawalPolicy {
  periodDays: number;
  allowedAfterProvisioning: boolean;
  unprovisionedAlwaysWithdrawable: true;
  provisionedRefundPolicy: 'unused_period_prorated';
}

export interface PublicServicePlanOffering {
  id: string;
  name: string;
  description: string | null;
  serviceTypeId: string;
  serviceTypeName: string;
  billingIntervalType: BillingIntervalType;
  billingIntervalValue: number;
  totalPrice: number;
  totalGross: number;
  taxRate: number;
  totalPriceFrom?: number;
  totalGrossFrom?: number;
  orderingHighlights: ServicePlanOrderingHighlight[];
  allowCustomerLocationSelection?: boolean;
  allowCustomerServerTypeSelection: boolean;
  withdrawalPolicy: WithdrawalPolicy;
}

export interface PublicServicePlanOfferingsListParams {
  limit?: number;
  offset?: number;
  serviceTypeId?: string;
}
