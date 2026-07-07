import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, MoreThan, Repository } from 'typeorm';

import { PublicWithdrawalRequestEntity } from '../entities/public-withdrawal-request.entity';

@Injectable()
export class PublicWithdrawalRequestsRepository {
  constructor(
    @InjectRepository(PublicWithdrawalRequestEntity)
    private readonly repository: Repository<PublicWithdrawalRequestEntity>,
  ) {}

  async createRequest(
    subscriptionId: string,
    confirmationCode: string,
    expiresAt: Date,
  ): Promise<PublicWithdrawalRequestEntity> {
    const entity = this.repository.create({
      subscriptionId,
      confirmationCode,
      expiresAt,
    });

    return await this.repository.save(entity);
  }

  async findPendingById(id: string, now: Date = new Date()): Promise<PublicWithdrawalRequestEntity | null> {
    return await this.repository.findOne({
      where: {
        id,
        confirmedAt: IsNull(),
        expiresAt: MoreThan(now),
      },
    });
  }

  async findActivePendingBySubscriptionId(
    subscriptionId: string,
    now: Date = new Date(),
  ): Promise<PublicWithdrawalRequestEntity | null> {
    return await this.repository.findOne({
      where: {
        subscriptionId,
        confirmedAt: IsNull(),
        expiresAt: MoreThan(now),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async invalidateExpiredOrConfirmedForSubscription(subscriptionId: string, now: Date = new Date()): Promise<void> {
    await this.repository.delete({
      subscriptionId,
      confirmedAt: IsNull(),
      expiresAt: LessThanOrEqual(now),
    });
  }

  async markCodeVerified(id: string, verifiedAt: Date): Promise<void> {
    await this.repository.update(id, { codeVerifiedAt: verifiedAt });
  }

  async markConfirmed(id: string, confirmedAt: Date): Promise<void> {
    await this.repository.update(id, { confirmedAt });
  }
}
