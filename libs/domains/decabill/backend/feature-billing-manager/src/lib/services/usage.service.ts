import { BadRequestException, Injectable } from '@nestjs/common';

import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { UsageRecordsRepository } from '../repositories/usage-records.repository';

@Injectable()
export class UsageService {
  constructor(
    private readonly usageRecordsRepository: UsageRecordsRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
  ) {}

  async getLatestUsage(subscriptionId: string) {
    return await this.usageRecordsRepository.findLatestForSubscription(subscriptionId);
  }

  async createUsage(dto: {
    subscriptionId: string;
    periodStart: Date;
    periodEnd: Date;
    usageSource: string;
    usagePayload: Record<string, unknown>;
  }) {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(dto.subscriptionId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);

    if (plan.billInAdvance === true) {
      throw new BadRequestException('Usage-based billing is not available for advance-billed (prepaid) subscriptions');
    }

    return await this.usageRecordsRepository.create(dto);
  }
}
