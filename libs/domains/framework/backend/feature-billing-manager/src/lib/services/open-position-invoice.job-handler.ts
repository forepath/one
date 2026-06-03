import { Injectable, Logger } from '@nestjs/common';

import { OpenPositionsRepository } from '../repositories/open-positions.repository';
import { UsersBillingDayRepository } from '../repositories/users-billing-day.repository';
import { getTodayBillingDay } from '../utils/billing-day.utils';

import { InvoiceCreationService } from './invoice-creation.service';

@Injectable()
export class OpenPositionInvoiceJobHandler {
  private readonly logger = new Logger(OpenPositionInvoiceJobHandler.name);

  constructor(
    private readonly usersBillingDayRepository: UsersBillingDayRepository,
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly invoiceCreationService: InvoiceCreationService,
  ) {}

  async findUserIdsForTodayBillingDay(): Promise<string[]> {
    const todayDay = getTodayBillingDay();

    return this.usersBillingDayRepository.findUserIdsWithBillingDay(todayDay);
  }

  async processUserOpenPositions(userId: string): Promise<{ invoiceRefId?: string; skipped: boolean }> {
    const positions = await this.openPositionsRepository.findUnbilledByUserId(userId);

    if (positions.length === 0) {
      return { skipped: true };
    }

    try {
      const result = await this.invoiceCreationService.createAccumulatedInvoice(userId, positions);

      if (result?.invoiceRefId) {
        this.logger.log(
          `Created accumulated invoice for user ${userId}, ${positions.length} position(s), ref ${result.invoiceRefId}`,
        );

        return { invoiceRefId: result.invoiceRefId, skipped: false };
      }

      return { skipped: true };
    } catch (error) {
      this.logger.error(`Failed to create accumulated invoice for user ${userId}: ${(error as Error).message}`);
      throw error;
    }
  }
}
