import { UsersRepository } from '@forepath/identity/backend';
import { Injectable, NotFoundException } from '@nestjs/common';

import type { SubscriptionResponseDto } from '../dto/subscription-response.dto';
import type {
  AdminBillingSummaryResponseDto,
  AdminSubscriptionListItemDto,
  PaginatedAdminSubscriptionsResponseDto,
} from '../dto/admin-billing.dto';
import { SubscriptionStatus, type SubscriptionEntity } from '../entities/subscription.entity';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { InvoiceCreationService } from './invoice-creation.service';
import { SubscriptionService } from './subscription.service';

@Injectable()
export class BillingAdminService {
  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly invoiceCreationService: InvoiceCreationService,
    private readonly subscriptionService: SubscriptionService,
    private readonly usersRepository: UsersRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
  ) {}

  async getGlobalSummary(): Promise<AdminBillingSummaryResponseDto> {
    const [activeSubscriptionsCount, openOverdue, userIdsWithUnbilled] = await Promise.all([
      this.subscriptionsRepository.countByStatus(SubscriptionStatus.ACTIVE),
      this.invoicesRepository.findGlobalOpenOverdueSummary(),
      this.openPositionsRepository.findDistinctUserIdsWithUnbilled(),
    ]);
    let unbilledTotal = 0;

    for (const userId of userIdsWithUnbilled) {
      unbilledTotal += await this.invoiceCreationService.getUnbilledTotalForUser(userId);
    }

    return {
      activeSubscriptionsCount,
      openOverdueCount: openOverdue.count,
      openOverdueTotal: openOverdue.totalBalance,
      unbilledTotal: Math.round(unbilledTotal * 100) / 100,
    };
  }

  async listUserSubscriptions(userId: string, limit: number, offset: number): Promise<SubscriptionEntity[]> {
    const user = await this.usersRepository.findByIdForTenant(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return await this.subscriptionService.listSubscriptions(userId, limit, offset);
  }

  async listSubscriptionsForAdmin(params: {
    limit: number;
    offset: number;
    search?: string;
    userId?: string;
  }): Promise<PaginatedAdminSubscriptionsResponseDto> {
    const { items, total } = await this.subscriptionsRepository.findAllForAdmin(params);
    const adminItems = await this.mapEntitiesToAdminListItems(items);

    return {
      items: adminItems,
      total,
      limit: params.limit,
      offset: params.offset,
    };
  }

  async cancelSubscriptionForAdmin(subscriptionId: string): Promise<AdminSubscriptionListItemDto> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const updated = await this.subscriptionService.cancelSubscription(subscriptionId, subscription.userId);

    return (await this.mapEntitiesToAdminListItems([updated]))[0];
  }

  async withdrawSubscriptionForAdmin(subscriptionId: string): Promise<AdminSubscriptionListItemDto> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const { subscription: updated, withdrawalResult } = await this.subscriptionService.withdrawSubscription(
      subscriptionId,
      subscription.userId,
    );
    const [item] = await this.mapEntitiesToAdminListItems([updated]);

    return { ...item, withdrawalResult };
  }

  async resumeSubscriptionForAdmin(subscriptionId: string): Promise<AdminSubscriptionListItemDto> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const updated = await this.subscriptionService.resumeSubscription(subscriptionId, subscription.userId);

    return (await this.mapEntitiesToAdminListItems([updated]))[0];
  }

  private async mapEntitiesToAdminListItems(entities: SubscriptionEntity[]): Promise<AdminSubscriptionListItemDto[]> {
    if (entities.length === 0) {
      return [];
    }

    const mapped = await this.subscriptionService.mapManyToResponses(entities);

    return this.enrichMappedSubscriptions(mapped);
  }

  private async enrichMappedSubscriptions(mapped: SubscriptionResponseDto[]): Promise<AdminSubscriptionListItemDto[]> {
    const userIds = [...new Set(mapped.map((subscription) => subscription.userId))];
    const planIds = [...new Set(mapped.map((subscription) => subscription.planId))];
    const userEmailById = new Map<string, string>();
    const planNameById = new Map<string, string>();

    await Promise.all(
      userIds.map(async (userId) => {
        const user = await this.usersRepository.findByIdForTenant(userId);

        if (user?.email) {
          userEmailById.set(userId, user.email);
        }
      }),
    );

    await Promise.all(
      planIds.map(async (planId) => {
        const plan = await this.servicePlansRepository.findById(planId);

        if (plan?.name) {
          planNameById.set(planId, plan.name);
        }
      }),
    );

    return mapped.map((subscription) => ({
      ...subscription,
      userEmail: userEmailById.get(subscription.userId),
      planName: planNameById.get(subscription.planId) ?? subscription.planId,
    }));
  }
}
