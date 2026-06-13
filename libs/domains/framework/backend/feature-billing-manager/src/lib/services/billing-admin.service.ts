import { Injectable } from '@nestjs/common';

import type { AdminBillingSummaryResponseDto } from '../dto/admin-billing.dto';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { InvoiceCreationService } from './invoice-creation.service';

@Injectable()
export class BillingAdminService {
  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly invoiceCreationService: InvoiceCreationService,
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
}
