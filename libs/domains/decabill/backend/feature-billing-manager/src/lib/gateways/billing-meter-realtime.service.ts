import { socketBroadcastRooms } from '@forepath/identity/backend';
import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

import type { SubscriptionMeterSummaryDto } from '../dto/meter-response.dto';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { MeterBillingService } from '../services/meter-billing.service';

export interface MeterSummaryUpdatePayload {
  subscriptionId: string;
  generatedAt: string;
  meters: SubscriptionMeterSummaryDto[];
}

/**
 * Emits subscription meter summary events to the `billing` Socket.IO namespace.
 * The billing status gateway calls `attachServer` during `afterInit`.
 */
@Injectable()
export class BillingMeterRealtimeService {
  private readonly logger = new Logger(BillingMeterRealtimeService.name);
  private server: Server | null = null;

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly meterBillingService: MeterBillingService,
  ) {}

  static subscriptionRoom(subscriptionId: string): string {
    return `subscription:${subscriptionId}`;
  }

  attachServer(server: Server): void {
    this.server = server;
    this.logger.log('Billing meter realtime attached to billing namespace server');
  }

  async buildMeterSummaryPayload(subscriptionId: string): Promise<MeterSummaryUpdatePayload | null> {
    try {
      const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
      const meters = await this.meterBillingService.buildSubscriptionMeterSummaries({
        subscription,
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
      });

      return {
        subscriptionId,
        generatedAt: new Date().toISOString(),
        meters,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Failed to build meter summary for subscription ${subscriptionId}: ${message}`);

      return null;
    }
  }

  async emitMeterSummaryUpdate(subscriptionId: string): Promise<void> {
    const payload = await this.buildMeterSummaryPayload(subscriptionId);

    if (!payload) {
      return;
    }

    if (!this.server) {
      this.logger.debug('Skip meterSummaryUpdate: server not attached yet');

      return;
    }

    const room = BillingMeterRealtimeService.subscriptionRoom(subscriptionId);

    // Per-event room reaches PAT / app token sockets permitted to receive meter updates.
    this.server.to(socketBroadcastRooms(room, 'meterSummaryUpdate')).emit('meterSummaryUpdate', payload);
  }
}
