import { TaxCategory } from '../constants/tax-category.constants';
import { BillingIntervalType, ServicePlanOrderingHighlight } from '../entities/service-plan.entity';

import { DocumentTermsResponseDto, EffectiveDocumentTermsResponseDto } from './document-terms.dto';
import { AttachedMeterResponseDto } from './meter-response.dto';
import { WithdrawalPolicyDto } from './withdrawal-policy.dto';

/** Terms fields are the plan's overrides (null = global default). */
export class ServicePlanResponseDto extends DocumentTermsResponseDto {
  id!: string;
  serviceTypeId!: string | null;
  name!: string;
  description?: string;
  billingIntervalType!: BillingIntervalType;
  billingIntervalValue!: number;
  billingDayOfMonth?: number;
  cancelAtPeriodEnd!: boolean;
  /** When true, the period is billed at start (prepaid). */
  billInAdvance!: boolean;
  /**
   * When true, nightly automatic price recalculation from the provider catalog is enabled
   * for this plan (opt-in; default false).
   */
  autoRecalculatePriceDaily!: boolean;
  minCommitmentDays!: number;
  noticeDays!: number;
  basePrice?: string;
  marginPercent?: string;
  marginFixed?: string;
  providerConfigDefaults!: Record<string, unknown>;
  orderingHighlights!: ServicePlanOrderingHighlight[];
  /** When true, customers may override region/location in POST /subscriptions requestedConfig if the schema allows. */
  allowCustomerLocationSelection!: boolean;
  /** When true, customers may choose serverType from allowedServerTypes at checkout. */
  allowCustomerServerTypeSelection!: boolean;
  /** Server type ids customers may select when allowCustomerServerTypeSelection is true. */
  allowedServerTypes!: string[];
  /** When true, customers may choose provider from allowedProviders at checkout. */
  allowCustomerProviderSelection!: boolean;
  /**
   * With customer selection: checkout options.
   * Without: single pinned provider when the service type has multiple providers.
   */
  allowedProviders!: string[];
  taxCategory!: TaxCategory;
  /** Terms applied to this plan's invoices (plan override, else global default). */
  effectiveDocumentTerms!: EffectiveDocumentTermsResponseDto;
  withdrawalPolicy!: WithdrawalPolicyDto;
  meters!: AttachedMeterResponseDto[];
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
