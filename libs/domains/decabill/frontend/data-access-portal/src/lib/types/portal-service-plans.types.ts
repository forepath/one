/** Matches {@link PublicServicePlanOfferingDto} from the billing API. */

export type BillingIntervalType = 'hour' | 'day' | 'month';

export interface ServicePlanOrderingHighlight {
  icon: string;
  text: string;
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
  orderingHighlights: ServicePlanOrderingHighlight[];
}

export interface PublicServicePlanOfferingsListParams {
  limit?: number;
  offset?: number;
  serviceTypeId?: string;
}
