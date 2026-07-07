import { BadRequestException, Injectable } from '@nestjs/common';

import type { OpenPositionEntity } from '../entities/open-position.entity';
import { BillingIntervalType } from '../entities/service-plan.entity';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { UsageRecordsRepository } from '../repositories/usage-records.repository';
import { groupOpenPositionsBySubscription } from '../utils/open-position-grouping.util';
import { calculateProratedAmount } from '../utils/billing-proration.util';
import { getEarliestProvisionedAt } from '../utils/provisioned-billing.util';
import { resolveSubscriptionBillingBaseOverride } from '../utils/server-type-billing.utils';
import { resolvePlanTaxCategory } from '../utils/plan-tax.utils';

import { BillingScheduleService } from './billing-schedule.service';
import { InvoiceService } from './invoice.service';
import { PricingService } from './pricing.service';
import { ProviderServerTypesService } from './provider-server-types.service';

interface InvoiceCreationOptions {
  billUntil?: Date;
  skipIfNoBillableAmount?: boolean;
}

const MIN_BILLABLE_AMOUNT = 0.01;

@Injectable()
export class InvoiceCreationService {
  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly pricingService: PricingService,
    private readonly invoiceService: InvoiceService,
    private readonly usageRecordsRepository: UsageRecordsRepository,
    private readonly billingScheduleService: BillingScheduleService,
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly providerServerTypesService: ProviderServerTypesService,
  ) {}

  async createInvoice(subscriptionId: string, userId: string, description?: string, options?: InvoiceCreationOptions) {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (subscription.userId !== userId) {
      throw new BadRequestException('Subscription does not belong to user');
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const pricing = await this.resolveSubscriptionPricing(subscriptionId, plan);
    const usage = await this.usageRecordsRepository.findLatestForSubscription(subscriptionId);
    const usageCost = usage ? this.extractUsageCost(usage.usagePayload) : 0;
    const billUntil = options?.billUntil ?? new Date();
    const baseAmount = await this.calculateBaseAmountSinceLastBilling(
      subscription,
      plan,
      pricing.totalPrice,
      billUntil,
    );
    const total = baseAmount + usageCost;

    if (total < MIN_BILLABLE_AMOUNT) {
      if (options?.skipIfNoBillableAmount) {
        return undefined;
      }

      throw new BadRequestException('No billable amount since last invoice');
    }

    const roundedTotal = Math.round(total * 100) / 100;
    const taxCategory = resolvePlanTaxCategory(plan);

    return await this.invoiceService.createAndIssue({
      subscriptionId,
      userId,
      lineInputs: [
        {
          description: description || 'Subscription charge',
          quantity: 1,
          unitPriceNet: roundedTotal,
          taxCategory,
        },
      ],
    });
  }

  async createAccumulatedInvoice(
    userId: string,
    positions: OpenPositionEntity[],
  ): Promise<{ invoiceRefId: string } | undefined> {
    if (positions.length === 0) {
      return undefined;
    }

    const groups = groupOpenPositionsBySubscription(positions);
    const billableGroups: {
      group: (typeof groups)[number];
      amount: number;
    }[] = [];

    for (const group of groups) {
      if (group.representative.userId !== userId) {
        throw new BadRequestException('Position does not belong to user');
      }

      const amount = await this.getBillableAmountForPosition(group.representative);

      if (amount >= MIN_BILLABLE_AMOUNT) {
        billableGroups.push({ group, amount });
      }
    }

    const total = billableGroups.reduce((sum, entry) => sum + entry.amount, 0);

    if (total < MIN_BILLABLE_AMOUNT) {
      return undefined;
    }

    const lineInputs = await Promise.all(
      billableGroups.map(async ({ group, amount }) => {
        const subscription = await this.subscriptionsRepository.findByIdOrThrow(group.subscriptionId);
        const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);

        return {
          description: group.representative.description ?? 'Subscription',
          quantity: 1,
          unitPriceNet: Math.round(amount * 100) / 100,
          taxCategory: resolvePlanTaxCategory(plan),
        };
      }),
    );
    const primarySubscriptionId = billableGroups[0].group.subscriptionId;
    const result = await this.invoiceService.createAndIssue({
      subscriptionId: primarySubscriptionId,
      userId,
      lineInputs,
    });
    const positionIds = billableGroups.flatMap(({ group }) => group.positions.map((position) => position.id));

    await this.openPositionsRepository.markManyBilled(positionIds, result.invoiceRefId);

    return { invoiceRefId: result.invoiceRefId };
  }

  async getUnbilledTotalForUser(userId: string): Promise<number> {
    const positions = await this.openPositionsRepository.findUnbilledByUserId(userId);
    const groups = groupOpenPositionsBySubscription(positions);
    let total = 0;

    for (const group of groups) {
      const amount = await this.getBillableAmountForPosition(group.representative);

      if (amount >= MIN_BILLABLE_AMOUNT) {
        total += amount;
      }
    }

    return Math.round(total * 100) / 100;
  }

  private async getBillableAmountForPosition(position: OpenPositionEntity): Promise<number> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(position.subscriptionId);

    if (subscription.userId !== position.userId) {
      throw new BadRequestException('Subscription does not belong to user');
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const pricing = await this.resolveSubscriptionPricing(position.subscriptionId, plan);
    const usage = await this.usageRecordsRepository.findLatestForSubscription(position.subscriptionId);
    const usageCost = usage ? this.extractUsageCost(usage.usagePayload) : 0;
    const baseAmount = await this.calculateBaseAmountSinceLastBilling(
      subscription,
      plan,
      pricing.totalPrice,
      position.billUntil,
    );
    const total = baseAmount + usageCost;

    if (total < MIN_BILLABLE_AMOUNT) {
      if (position.skipIfNoBillableAmount) {
        return 0;
      }

      throw new BadRequestException('No billable amount since last invoice');
    }

    return total;
  }

  private extractUsageCost(payload: Record<string, unknown>): number {
    const direct = this.parseNumeric(payload['totalCost']) ?? this.parseNumeric(payload['usageCost']);

    if (direct !== null) {
      return direct;
    }

    const units = this.parseNumeric(payload['units']);
    const unitPrice = this.parseNumeric(payload['unitPrice']);

    if (units !== null && unitPrice !== null) {
      return units * unitPrice;
    }

    return 0;
  }

  private parseNumeric(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);

      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private async calculateBaseAmountSinceLastBilling(
    subscription: SubscriptionEntity,
    plan: ServicePlanEntity,
    fullPeriodPrice: number,
    billUntil: Date,
    now: Date = new Date(),
  ): Promise<number> {
    const subscriptionStart = subscription.currentPeriodStart ?? subscription.createdAt ?? now;
    const subscriptionEndOrToday =
      subscription.cancelEffectiveAt && subscription.cancelEffectiveAt < now ? subscription.cancelEffectiveAt : now;
    let effectiveUntil = billUntil;

    if (effectiveUntil > subscriptionEndOrToday) {
      effectiveUntil = subscriptionEndOrToday;
    }

    if (effectiveUntil <= subscriptionStart) {
      return 0;
    }

    const latestInvoice = await this.invoicesRepository.findLatestBySubscription(subscription.id);
    let lastBillingAt: Date | undefined = latestInvoice?.createdAt;

    if (!lastBillingAt) {
      lastBillingAt = subscription.currentPeriodStart ?? subscription.createdAt;
    }

    if (!lastBillingAt) {
      return fullPeriodPrice;
    }

    if (lastBillingAt < subscriptionStart) {
      lastBillingAt = subscriptionStart;
    }

    if (subscription.withdrawnAt) {
      const items = await this.subscriptionItemsRepository.findBySubscription(subscription.id);
      const provisionedFrom = getEarliestProvisionedAt(items);

      if (!provisionedFrom) {
        return 0;
      }

      if (!lastBillingAt || lastBillingAt < provisionedFrom) {
        lastBillingAt = provisionedFrom;
      }
    }

    if (effectiveUntil <= lastBillingAt) {
      return 0;
    }

    return calculateProratedAmount(plan, fullPeriodPrice, lastBillingAt, effectiveUntil, this.billingScheduleService);
  }

  private async resolveSubscriptionPricing(subscriptionId: string, plan: ServicePlanEntity) {
    const items = await this.subscriptionItemsRepository.findBySubscription(subscriptionId);
    const basePriceOverride = await resolveSubscriptionBillingBaseOverride(items, this.providerServerTypesService);

    return this.pricingService.calculate(plan, basePriceOverride);
  }
}
