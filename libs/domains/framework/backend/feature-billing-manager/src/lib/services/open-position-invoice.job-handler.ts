import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { UsersBillingDayRepository } from '../repositories/users-billing-day.repository';
import { getTodayBillingDay } from '../utils/billing-day.utils';

import { BillingAuditLogService } from './billing-audit-log.service';
import { InvoiceCreationService } from './invoice-creation.service';

export interface OpenPositionInvoiceTriggerContext {
  triggeredBy?: string;
  scope?: 'all' | 'user';
  requestId?: string;
}

@Injectable()
export class OpenPositionInvoiceJobHandler {
  private readonly logger = new Logger(OpenPositionInvoiceJobHandler.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly usersBillingDayRepository: UsersBillingDayRepository,
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly invoiceCreationService: InvoiceCreationService,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  async findUserIdsForTodayBillingDay(): Promise<string[]> {
    const todayDay = getTodayBillingDay();

    return this.usersBillingDayRepository.findUserIdsWithBillingDay(todayDay);
  }

  async processUserOpenPositions(
    userId: string,
    trigger?: OpenPositionInvoiceTriggerContext,
  ): Promise<{ invoiceRefId?: string; skipped: boolean }> {
    const positions = await this.dataSource.transaction(async (manager) =>
      this.openPositionsRepository.findUnbilledByUserIdForUpdate(userId, manager),
    );

    if (positions.length === 0) {
      return { skipped: true };
    }

    try {
      const result = await this.invoiceCreationService.createAccumulatedInvoice(userId, positions);

      if (result?.invoiceRefId) {
        this.logger.log(
          `Created accumulated invoice for user ${userId}, ${positions.length} open position(s), ref ${result.invoiceRefId}`,
        );

        if (trigger?.triggeredBy) {
          await this.auditLog.log({
            process: 'invoice.bill_now',
            level: 'info',
            message: 'Admin bill-now created invoice',
            invoiceId: result.invoiceRefId,
            userId,
            context: {
              triggeredBy: trigger.triggeredBy,
              scope: trigger.scope,
              requestId: trigger.requestId,
            },
          });
        }

        return { invoiceRefId: result.invoiceRefId, skipped: false };
      }

      return { skipped: true };
    } catch (error) {
      this.logger.error(`Failed to create accumulated invoice for user ${userId}: ${(error as Error).message}`);

      if (trigger?.triggeredBy) {
        await this.auditLog.log({
          process: 'invoice.bill_now',
          level: 'error',
          message: 'Admin bill-now failed for user',
          userId,
          context: {
            triggeredBy: trigger.triggeredBy,
            scope: trigger.scope,
            requestId: trigger.requestId,
            error: (error as Error).message,
          },
        });
      }

      throw error;
    }
  }
}
