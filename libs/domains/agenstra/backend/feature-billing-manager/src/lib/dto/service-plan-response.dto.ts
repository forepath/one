import { BillingIntervalType, ServicePlanOrderingHighlight } from '../entities/service-plan.entity';

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
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
