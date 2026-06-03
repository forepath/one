import { UsersRepository } from '@forepath/identity/backend';
import { Injectable } from '@nestjs/common';

import type {
  AdminBillNowDto,
  AdminBillNowResponseDto,
  AdminBillingSummaryResponseDto,
} from '../dto/admin-billing.dto';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { BillingAuditLogService } from './billing-audit-log.service';
import { InvoiceCreationService } from './invoice-creation.service';
import { OpenPositionInvoiceJobHandler } from './open-position-invoice.job-handler';

@Injectable()
export class BillingAdminService {
  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly invoiceCreationService: InvoiceCreationService,
    private readonly openPositionInvoiceJobHandler: OpenPositionInvoiceJobHandler,
    private readonly auditLog: BillingAuditLogService,
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

  async billNow(adminUserId: string, dto: AdminBillNowDto): Promise<AdminBillNowResponseDto> {
    const scope = dto.userId ? 'user' : 'all';
    const userIds = dto.userId ? [dto.userId] : await this.openPositionsRepository.findDistinctUserIdsWithUnbilled();
    let usersProcessed = 0;
    let invoicesCreated = 0;
    let usersSkipped = 0;
    const errors: AdminBillNowResponseDto['errors'] = [];

    for (const userId of userIds) {
      try {
        const result = await this.openPositionInvoiceJobHandler.processUserOpenPositions(userId);

        usersProcessed += 1;

        if (result.skipped) {
          usersSkipped += 1;
          continue;
        }

        if (result.invoiceRefId) {
          invoicesCreated += 1;

          await this.auditLog.log({
            process: 'invoice.bill_now',
            level: 'info',
            message: 'Admin bill-now created invoice',
            invoiceId: result.invoiceRefId,
            userId,
            context: { triggeredBy: adminUserId, scope },
          });
        } else {
          usersSkipped += 1;
        }
      } catch (error) {
        errors.push({
          userId,
          message: (error as Error).message,
        });
      }
    }

    if (dto.userId && userIds.length === 0) {
      const user = await this.usersRepository.findById(dto.userId);

      if (!user) {
        errors.push({ userId: dto.userId, message: 'User not found' });
      } else {
        usersSkipped += 1;
      }
    }

    return {
      usersProcessed,
      invoicesCreated,
      usersSkipped,
      errors,
    };
  }
}
