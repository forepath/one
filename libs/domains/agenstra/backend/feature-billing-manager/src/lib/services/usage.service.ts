import { Injectable } from '@nestjs/common';

import { UsageRecordsRepository } from '../repositories/usage-records.repository';

@Injectable()
export class UsageService {
  constructor(private readonly usageRecordsRepository: UsageRecordsRepository) {}

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
    return await this.usageRecordsRepository.create(dto);
  }
}
