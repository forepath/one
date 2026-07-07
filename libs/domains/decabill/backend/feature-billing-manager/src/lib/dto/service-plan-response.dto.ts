import { TaxCategory } from '../constants/tax-category.constants';
import { BillingIntervalType, ServicePlanOrderingHighlight } from '../entities/service-plan.entity';

import { WithdrawalPolicyDto } from './withdrawal-policy.dto';

export class ServicePlanResponseDto {
  id!: string;
  serviceTypeId!: string;
  name!: string;
  description?: string;
  billingIntervalType!: BillingIntervalType;
  billingIntervalValue!: number;
  billingDayOfMonth?: number;
  cancelAtPeriodEnd!: boolean;
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
  taxCategory!: TaxCategory;
  withdrawalPolicy!: WithdrawalPolicyDto;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
