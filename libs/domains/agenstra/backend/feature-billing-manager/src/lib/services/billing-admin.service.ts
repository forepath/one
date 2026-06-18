import { UsersRepository } from '@forepath/identity/backend';
import { Injectable, NotFoundException } from '@nestjs/common';

import type { AdminBillingSummaryResponseDto } from '../dto/admin-billing.dto';
import { SubscriptionStatus, type SubscriptionEntity } from '../entities/subscription.entity';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
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
    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return await this.subscriptionService.listSubscriptions(userId, limit, offset);
  }
}
