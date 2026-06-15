import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { SubscriptionItemResponseDto } from '../dto/subscription-item-response.dto';
import { ProvisioningStatus } from '../entities/subscription-item.entity';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { ServerInfo } from '../utils/provisioning.utils';

import { CloudflareDnsService } from './cloudflare-dns.service';
import { ProvisioningService } from './provisioning.service';
import { SubscriptionService } from './subscription.service';

@Injectable()
export class SubscriptionItemServerService {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly provisioningService: ProvisioningService,
    private readonly cloudflareDnsService: CloudflareDnsService,
  ) {}

  /**
   * Lists subscription items for a subscription. Ensures the subscription belongs to the user.
   */
  async listItems(subscriptionId: string, userId: string): Promise<SubscriptionItemResponseDto[]> {
    await this.subscriptionService.getSubscription(subscriptionId, userId);

    const items = await this.subscriptionItemsRepository.findBySubscription(subscriptionId);

    return items.map((item) => {
      const service = item.configSnapshot?.service as string | undefined;
      const serviceVal = service === 'manager' ? ('manager' as const) : ('controller' as const);

      return {
        id: item.id,
        subscriptionId: item.subscriptionId,
        serviceTypeId: item.serviceTypeId,
        provisioningStatus: item.provisioningStatus,
        hostname: item.hostname,
        service: serviceVal,
      };
    });
  }

  /**
   * Fetches server info from the provider, updates the cached snapshot, and returns it.
   * Ensures the subscription belongs to the user and the item is provisioned.
   */
  async getServerInfo(subscriptionId: string, itemId: string, userId: string): Promise<ServerInfo> {
    await this.subscriptionService.getSubscription(subscriptionId, userId);

    const item = await this.subscriptionItemsRepository.findByIdAndSubscriptionId(itemId, subscriptionId);

    if (!item) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    this.assertProvisioned(item.providerReference, item.provisioningStatus);

    const provider = item.serviceType?.provider;

    if (!provider) {
      throw new BadRequestException('Service type has no provider');
    }

    const info = await this.provisioningService.getServerInfo(provider, item.providerReference!);

    if (!info) {
      throw new BadRequestException('Provider does not support server info');
    }

    const metadata = { ...info.metadata, provider };
    const hostname = item.hostname;
    const hostnameFqdn = hostname ? this.cloudflareDnsService.getFqdn(hostname) : undefined;

    await this.subscriptionItemsRepository.updateServerInfoSnapshot(itemId, {
      serverId: info.serverId,
      name: info.name,
      publicIp: info.publicIp,
      privateIp: info.privateIp,
      status: info.status,
      metadata,
    });

    return { ...info, metadata, hostname, hostnameFqdn };
  }

  async startServer(subscriptionId: string, itemId: string, userId: string): Promise<void> {
    const item = await this.resolveItemForAction(subscriptionId, itemId, userId);

    await this.provisioningService.startServer(item.serviceType!.provider!, item.providerReference!);
  }

  async stopServer(subscriptionId: string, itemId: string, userId: string): Promise<void> {
    const item = await this.resolveItemForAction(subscriptionId, itemId, userId);

    await this.provisioningService.stopServer(item.serviceType!.provider!, item.providerReference!);
  }

  async restartServer(subscriptionId: string, itemId: string, userId: string): Promise<void> {
    const item = await this.resolveItemForAction(subscriptionId, itemId, userId);

    await this.provisioningService.restartServer(item.serviceType!.provider!, item.providerReference!);
  }

  private async resolveItemForAction(subscriptionId: string, itemId: string, userId: string) {
    await this.subscriptionService.getSubscription(subscriptionId, userId);

    const item = await this.subscriptionItemsRepository.findByIdAndSubscriptionId(itemId, subscriptionId);

    if (!item) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    this.assertProvisioned(item.providerReference, item.provisioningStatus);

    if (!item.serviceType?.provider) {
      throw new BadRequestException('Service type has no provider');
    }

    return item;
  }

  private assertProvisioned(providerReference: string | undefined, status: ProvisioningStatus): void {
    if (!providerReference) {
      throw new BadRequestException('Service is not provisioned yet');
    }

    if (status !== ProvisioningStatus.ACTIVE) {
      throw new BadRequestException(
        `Service is not active (status: ${status}). Only provisioned services can be queried or controlled.`,
      );
    }
  }
}
