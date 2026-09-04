import { Injectable, Logger } from '@nestjs/common';

import { OffersRepository } from '../repositories/offers.repository';
import { OffersAdminService } from './offers-admin.service';

@Injectable()
export class OfferExpirationJobHandler {
  private readonly logger = new Logger(OfferExpirationJobHandler.name);

  constructor(
    private readonly offersRepository: OffersRepository,
    private readonly offersAdminService: OffersAdminService,
  ) {}

  async findExpiredOfferIds(): Promise<string[]> {
    const offers = await this.offersRepository.findArchivedExpired(new Date());

    return offers.map((offer) => offer.id);
  }

  async expireOffer(offerId: string): Promise<void> {
    try {
      await this.offersAdminService.expireOffer(offerId);
      this.logger.log(`Expired offer ${offerId}`);
    } catch (error) {
      this.logger.error(`Failed to expire offer ${offerId}: ${(error as Error).message}`);
      throw error;
    }
  }
}
