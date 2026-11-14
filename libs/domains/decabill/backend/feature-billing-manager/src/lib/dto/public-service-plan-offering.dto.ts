import { BillingIntervalType, ServicePlanOrderingHighlight } from '../entities/service-plan.entity';

import { EffectiveDocumentTermsResponseDto } from './document-terms.dto';
import { WithdrawalPolicyDto } from './withdrawal-policy.dto';

/** Safe subset of a service plan for public marketing / external card UIs. */
export class PublicServicePlanOfferingDto {
  id!: string;
  name!: string;
  description!: string | null;
  serviceTypeId!: string | null;
  serviceTypeName!: string;
  billingIntervalType!: BillingIntervalType;
  billingIntervalValue!: number;
  /** When true, the period is billed at start (prepaid). */
  billInAdvance!: boolean;
  /**
   * When true, the package may have its price recalculated nightly from the provider catalog.
   * Checkout UIs must disclose this and the statutory withdrawal restart on change.
   */
  autoRecalculatePriceDaily!: boolean;
  /** Customer-facing total (base + margin); margin breakdown is not exposed. */
  totalPrice!: number;
  /** Customer-facing gross total (incl. VAT) for the default server type. */
  totalGross!: number;
  /** Applied VAT rate in percent for this plan. */
  taxRate!: number;
  /** Lowest customer total across allowed server types when allowCustomerServerTypeSelection is true. */
  totalPriceFrom?: number;
  /** Lowest customer gross total across allowed server types when allowCustomerServerTypeSelection is true. */
  totalGrossFrom?: number;
  orderingHighlights!: ServicePlanOrderingHighlight[];
  /** When true, checkout UIs may offer region/location selection for this plan. */
  allowCustomerLocationSelection!: boolean;
  /** When true, checkout UIs may offer server type selection from allowed types. */
  allowCustomerServerTypeSelection!: boolean;
  /** When true, checkout UIs may offer provider selection from allowedProviders. */
  allowCustomerProviderSelection!: boolean;
  /** Checkout options when selection is allowed; otherwise the pinned plan provider (length 0–1). */
  allowedProviders!: string[];
  withdrawalPolicy!: WithdrawalPolicyDto;
  /** Payment / delivery terms applied to this plan's invoices (plan override, else global default). */
  effectiveDocumentTerms!: EffectiveDocumentTermsResponseDto;
}
