import { Injectable, Logger } from '@nestjs/common';

import { WebhookDeliveriesRepository } from '../repositories/webhook-deliveries.repository';
import { WebhookEndpointsRepository } from '../repositories/webhook-endpoints.repository';
import {
  resolveRetentionCutoff,
  resolveWebhookDeliveryLogRetentionPolicy,
  type WebhookDeliveryLogRetentionSource,
} from '../utils/webhook-delivery-log-retention.utils';

export interface WebhookDeliveryRetentionResult {
  deletedByAge: number;
  deletedByCount: number;
}

@Injectable()
export class WebhookDeliveryRetentionService {
  private readonly logger = new Logger(WebhookDeliveryRetentionService.name);

  constructor(
    private readonly deliveriesRepository: WebhookDeliveriesRepository,
    private readonly endpointsRepository: WebhookEndpointsRepository,
  ) {}

  async applyRetentionForEndpoint(
    endpoint: WebhookDeliveryLogRetentionSource & { id: string },
  ): Promise<WebhookDeliveryRetentionResult> {
    const policy = resolveWebhookDeliveryLogRetentionPolicy(endpoint);
    const cutoff = resolveRetentionCutoff(policy.retentionDays);
    const deletedByAge = await this.deliveriesRepository.deleteOlderThan(endpoint.id, cutoff);

    const remaining = await this.deliveriesRepository.countByEndpointId(endpoint.id);
    let deletedByCount = 0;

    if (remaining > policy.maxEntries) {
      deletedByCount = await this.deliveriesRepository.deleteOldestExcess(endpoint.id, policy.maxEntries);
    }

    if (deletedByAge > 0 || deletedByCount > 0) {
      this.logger.debug(
        `Pruned webhook delivery logs for endpoint ${endpoint.id}: ${deletedByAge} by age, ${deletedByCount} by count`,
      );
    }

    return { deletedByAge, deletedByCount };
  }

  applyRetentionForEndpointFireAndForget(endpoint: WebhookDeliveryLogRetentionSource & { id: string }): void {
    void this.applyRetentionForEndpoint(endpoint).catch((error: Error) => {
      this.logger.warn(`Failed to prune delivery logs for endpoint ${endpoint.id}: ${error.message}`);
    });
  }

  async applyRetentionForAllEndpoints(
    batchSize = 100,
  ): Promise<{ endpointsProcessed: number; deletedByAge: number; deletedByCount: number }> {
    let offset = 0;
    let endpointsProcessed = 0;
    let deletedByAge = 0;
    let deletedByCount = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const endpoints = await this.endpointsRepository.findAllBatch(offset, batchSize);

      if (endpoints.length === 0) {
        break;
      }

      for (const endpoint of endpoints) {
        const result = await this.applyRetentionForEndpoint(endpoint);

        deletedByAge += result.deletedByAge;
        deletedByCount += result.deletedByCount;
        endpointsProcessed += 1;
      }

      offset += endpoints.length;

      if (endpoints.length < batchSize) {
        break;
      }
    }

    return { endpointsProcessed, deletedByAge, deletedByCount };
  }
}
