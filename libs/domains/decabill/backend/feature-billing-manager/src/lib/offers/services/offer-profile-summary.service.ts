import { Injectable } from '@nestjs/common';

import { OfferStatus } from '../constants/offer-status.constants';
import { OffersRepository } from '../repositories/offers.repository';

export interface CustomerOfferProfileCounts {
  pendingOffersCount: number;
  actionRequiredOffersCount: number;
}

export interface AdminOfferProfileCounts {
  draft: number;
  archived: number;
  accepted: number;
  declined: number;
  expired: number;
  revoked: number;
}

@Injectable()
export class OfferProfileSummaryService {
  constructor(private readonly offersRepository: OffersRepository) {}

  async getCustomerCounts(userId: string): Promise<CustomerOfferProfileCounts> {
    const pendingOffersCount = await this.offersRepository.countPendingForUser(userId);

    return {
      pendingOffersCount,
      actionRequiredOffersCount: pendingOffersCount,
    };
  }

  async getAdminCountsByStatus(userId: string): Promise<AdminOfferProfileCounts> {
    const [draft, archived, accepted, declined, expired, revoked] = await Promise.all([
      this.offersRepository.countByUserAndStatus(userId, [OfferStatus.DRAFT]),
      this.offersRepository.countByUserAndStatus(userId, [OfferStatus.ARCHIVED]),
      this.offersRepository.countByUserAndStatus(userId, [OfferStatus.ACCEPTED]),
      this.offersRepository.countByUserAndStatus(userId, [OfferStatus.DECLINED]),
      this.offersRepository.countByUserAndStatus(userId, [OfferStatus.EXPIRED]),
      this.offersRepository.countByUserAndStatus(userId, [OfferStatus.REVOKED]),
    ]);

    return { draft, archived, accepted, declined, expired, revoked };
  }
}
