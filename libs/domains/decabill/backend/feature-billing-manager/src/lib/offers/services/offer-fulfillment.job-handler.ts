import { Injectable, Logger } from '@nestjs/common';

import { OfferFulfillmentService } from './offer-fulfillment.service';
import { OfferLineItemsRepository } from '../repositories/offer-line-items.repository';

@Injectable()
export class OfferFulfillmentJobHandler {
  private readonly logger = new Logger(OfferFulfillmentJobHandler.name);

  constructor(
    private readonly offerLineItemsRepository: OfferLineItemsRepository,
    private readonly offerFulfillmentService: OfferFulfillmentService,
  ) {}

  async findDueLineIds(): Promise<Array<{ offerId: string; lineItemId: string }>> {
    const lines = await this.offerLineItemsRepository.findDueScheduledLines(new Date());

    return lines.map((line) => ({ offerId: line.offerId, lineItemId: line.id }));
  }

  async processLine(offerId: string, lineItemId: string): Promise<void> {
    try {
      await this.offerFulfillmentService.fulfillLine(offerId, lineItemId);
      this.logger.log(`Fulfilled offer line ${lineItemId} for offer ${offerId}`);
    } catch (error) {
      this.logger.error(`Failed to fulfill offer line ${lineItemId} for offer ${offerId}: ${(error as Error).message}`);
      throw error;
    }
  }
}
