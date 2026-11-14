import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { ContainerManagerService } from '../contributors/container-manager/services/container-manager.service';
import {
  SubscriptionItemDetailResponseDto,
  SubscriptionItemResponseDto,
  SubscriptionSshAccessKeyResponseDto,
  type ActiveSubscriptionAddonSummaryDto,
  type ServiceDetailTabDto,
} from '../dto/subscription-item-response.dto';
import { BillingEmailPublisher } from '../email/billing-email.publisher';
import { ProvisioningStatus } from '../entities/subscription-item.entity';
import { SubscriptionEntity, SubscriptionStatus } from '../entities/subscription.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { CloudInitConfigsRepository } from '../repositories/cloud-init-configs.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionAddonsRepository } from '../repositories/subscription-addons.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { normalizeCloudInitService } from '../utils/cloud-init/cloud-init-dispatch.utils';
import {
  CloudInitServiceType,
  canonicalizeIntegratedProvisioningService,
} from '../utils/cloud-init/integrated-provisioning-service';
import { CONTAINER_MANAGER_MODULE_KEY } from '../utils/plan-addons.utils';
import { getProvisioningCredentials } from '../utils/provider-env-defaults.utils';
import { resolveItemProvider } from '../utils/provider-selection.utils';
import { ServerInfo } from '../utils/provisioning.utils';
import {
  appendServiceTabs,
  createDetailsTab,
  sanitizeCloudInitServiceTabs,
  sortResolvedServiceTabs,
  type ResolvedServiceDetailTab,
} from '../utils/service-detail-tabs.utils';
import {
  mapServerInfoSnapshotToResponse,
  mapServerInfoToResponse,
  mapSubscriptionItemToResponse,
  enrichServerInfoWithConfigGeography,
  serverInfoHasGeography,
} from '../utils/subscription-item-response.utils';
import { isLiveAccessibleSubscriptionStatus } from '../utils/subscription-live-access.utils';

import { AddonModuleRegistryService } from './addon-module-registry.service';
import { CloudInitModuleRegistryService } from './cloud-init-module-registry.service';
import { CloudflareDnsService } from './cloudflare-dns.service';
import { IntegratedStackRegistryService } from './integrated-stack-registry.service';
import { ProvisioningDispatchService } from './provisioning-dispatch.service';
import { SubscriptionService } from './subscription.service';


const CLOUD_INIT_CONFIG_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class SubscriptionItemServerService {
  private readonly logger = new Logger(SubscriptionItemServerService.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly subscriptionAddonsRepository: SubscriptionAddonsRepository,
    private readonly provisioningDispatchService: ProvisioningDispatchService,
    private readonly cloudflareDnsService: CloudflareDnsService,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly billingEmailPublisher: BillingEmailPublisher,
    private readonly addonModuleRegistry: AddonModuleRegistryService,
    private readonly containerManagerService: ContainerManagerService,
    private readonly integratedStackRegistry: IntegratedStackRegistryService,
    private readonly cloudInitModuleRegistry: CloudInitModuleRegistryService,
    private readonly cloudInitConfigsRepository: CloudInitConfigsRepository,
  ) {}

  /**
   * Lists subscription items for a subscription. Ensures the subscription belongs to the user.
   */
  async listItems(subscriptionId: string, userId: string): Promise<SubscriptionItemResponseDto[]> {
    await this.subscriptionService.getSubscription(subscriptionId, userId);

    const items = await this.subscriptionItemsRepository.findBySubscription(subscriptionId);

    return items.map((item) => mapSubscriptionItemToResponse(item));
  }

  /**
   * Returns detail for a subscription item when it is active and provisioned.
   * Removed or non-active items are reported as not found.
   */
  async getItemDetail(
    subscriptionId: string,
    itemId: string,
    userId: string,
  ): Promise<SubscriptionItemDetailResponseDto> {
    await this.subscriptionService.getSubscription(subscriptionId, userId);

    return await this.buildItemDetail(subscriptionId, itemId);
  }

  /** Admin path: subscription ownership is not checked; caller must enforce admin role. */
  async getItemDetailAsAdmin(subscriptionId: string, itemId: string): Promise<SubscriptionItemDetailResponseDto> {
    await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    return await this.buildItemDetail(subscriptionId, itemId);
  }

  /**
   * Updates the customer-defined display name for a subscription item.
   * Empty or null clears the name. Non-detail-eligible items (removed or not active) return 404.
   */
  async updateDisplayName(
    subscriptionId: string,
    itemId: string,
    userId: string,
    displayName: string | null,
  ): Promise<SubscriptionItemResponseDto> {
    await this.subscriptionService.getSubscription(subscriptionId, userId);

    return await this.updateDisplayNameInternal(subscriptionId, itemId, displayName);
  }

  /** Admin path: subscription ownership is not checked; caller must enforce admin role. */
  async updateDisplayNameAsAdmin(
    subscriptionId: string,
    itemId: string,
    displayName: string | null,
  ): Promise<SubscriptionItemResponseDto> {
    await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    return await this.updateDisplayNameInternal(subscriptionId, itemId, displayName);
  }

  /**
   * One-time reveal of the provisioning SSH private key. Sets sshAccessGrantedAt and notifies.
   * Subsequent calls are rejected with ConflictException.
   */
  async getSshAccessKey(
    subscriptionId: string,
    itemId: string,
    userId: string,
  ): Promise<SubscriptionSshAccessKeyResponseDto> {
    const subscription = await this.subscriptionService.getSubscription(subscriptionId, userId);

    return await this.revealSshAccessKey(subscription, itemId, userId);
  }

  /** Admin path: subscription ownership is not checked; caller must enforce admin role. */
  async getSshAccessKeyAsAdmin(
    subscriptionId: string,
    itemId: string,
    adminUserId: string,
  ): Promise<SubscriptionSshAccessKeyResponseDto> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    return await this.revealSshAccessKey(subscription, itemId, adminUserId);
  }

  private async revealSshAccessKey(
    subscription: SubscriptionEntity,
    itemId: string,
    actorUserId: string,
  ): Promise<SubscriptionSshAccessKeyResponseDto> {
    const item = await this.subscriptionItemsRepository.findByIdAndSubscriptionId(itemId, subscription.id);

    if (!item) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    this.assertProvisioned(item.providerReference, item.provisioningStatus);

    const privateKey = item.sshPrivateKey?.trim();

    if (!privateKey) {
      throw new BadRequestException('SSH access key is not available for this service');
    }

    const claimed = await this.subscriptionItemsRepository.claimSshAccessGranted(itemId);

    if (!claimed) {
      throw new ConflictException('SSH access key has already been revealed for this service');
    }

    const grantedAt = new Date();
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);

    this.logger.log(
      `SSH access granted for subscription item ${itemId} on subscription ${subscription.id} by user ${actorUserId}`,
    );

    this.billingNotificationPublisher.publishSshAccessGranted({
      subscription,
      itemId: item.id,
      hostname: item.hostname,
      grantedAt,
    });
    await this.billingEmailPublisher.publishSshAccessGranted(subscription, plan.name, {
      itemId: item.id,
      hostname: item.hostname,
      grantedAt,
    });

    return { privateKey };
  }

  /**
   * Fetches server info from the provider, updates the cached snapshot, and returns it.
   * Ensures the subscription belongs to the user and the item is provisioned.
   */
  async getServerInfo(subscriptionId: string, itemId: string, userId: string): Promise<ServerInfo> {
    await this.subscriptionService.getSubscription(subscriptionId, userId);

    return await this.fetchServerInfoForItem(subscriptionId, itemId);
  }

  /** Admin path: subscription ownership is not checked; caller must enforce admin role. */
  async getServerInfoAsAdmin(subscriptionId: string, itemId: string): Promise<ServerInfo> {
    await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    return await this.fetchServerInfoForItem(subscriptionId, itemId);
  }

  async startServer(subscriptionId: string, itemId: string, userId: string): Promise<void> {
    const item = await this.resolveItemForAction(subscriptionId, itemId, userId);
    const credentials = getProvisioningCredentials(item.serviceType!.provider!, item.serviceType!.providerDefaults);

    await this.provisioningDispatchService.startServer(
      item.serviceType!.provider!,
      item.providerReference!,
      credentials,
    );

    this.billingNotificationPublisher.publish('subscription.service.started', { subscriptionId, itemId }, userId);
  }

  async stopServer(subscriptionId: string, itemId: string, userId: string): Promise<void> {
    const item = await this.resolveItemForAction(subscriptionId, itemId, userId);
    const credentials = getProvisioningCredentials(item.serviceType!.provider!, item.serviceType!.providerDefaults);

    await this.provisioningDispatchService.stopServer(
      item.serviceType!.provider!,
      item.providerReference!,
      credentials,
    );

    this.billingNotificationPublisher.publish('subscription.service.stopped', { subscriptionId, itemId }, userId);
  }

  async restartServer(subscriptionId: string, itemId: string, userId: string): Promise<void> {
    const item = await this.resolveItemForAction(subscriptionId, itemId, userId);
    const credentials = getProvisioningCredentials(item.serviceType!.provider!, item.serviceType!.providerDefaults);

    await this.provisioningDispatchService.restartServer(
      item.serviceType!.provider!,
      item.providerReference!,
      credentials,
    );

    this.billingNotificationPublisher.publish('subscription.service.restarted', { subscriptionId, itemId }, userId);
  }

  async startServerAsAdmin(subscriptionId: string, itemId: string, _adminUserId: string): Promise<void> {
    const { item, ownerUserId } = await this.resolveItemForAdminAction(subscriptionId, itemId);

    await this.provisioningDispatchService.startServer(
      item.serviceType!.provider!,
      item.providerReference!,
      getProvisioningCredentials(item.serviceType!.provider!, item.serviceType!.providerDefaults),
    );

    this.billingNotificationPublisher.publish('subscription.service.started', { subscriptionId, itemId }, ownerUserId);
  }

  async stopServerAsAdmin(subscriptionId: string, itemId: string, _adminUserId: string): Promise<void> {
    const { item, ownerUserId } = await this.resolveItemForAdminAction(subscriptionId, itemId);

    await this.provisioningDispatchService.stopServer(
      item.serviceType!.provider!,
      item.providerReference!,
      getProvisioningCredentials(item.serviceType!.provider!, item.serviceType!.providerDefaults),
    );

    this.billingNotificationPublisher.publish('subscription.service.stopped', { subscriptionId, itemId }, ownerUserId);
  }

  async restartServerAsAdmin(subscriptionId: string, itemId: string, _adminUserId: string): Promise<void> {
    const { item, ownerUserId } = await this.resolveItemForAdminAction(subscriptionId, itemId);

    await this.provisioningDispatchService.restartServer(
      item.serviceType!.provider!,
      item.providerReference!,
      getProvisioningCredentials(item.serviceType!.provider!, item.serviceType!.providerDefaults),
    );

    this.billingNotificationPublisher.publish(
      'subscription.service.restarted',
      { subscriptionId, itemId },
      ownerUserId,
    );
  }

  private async buildItemDetail(subscriptionId: string, itemId: string): Promise<SubscriptionItemDetailResponseDto> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (!this.isSubscriptionServiceDetailAccessible(subscription.status)) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    const item = await this.subscriptionItemsRepository.findByIdAndSubscriptionId(itemId, subscriptionId);

    if (!item || !this.isDetailEligible(item.providerReference, item.provisioningStatus)) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    const response: SubscriptionItemDetailResponseDto = {
      ...mapSubscriptionItemToResponse(item),
      tabs: [createDetailsTab()],
      activeAddons: [],
    };
    const hostname = item.hostname;
    const hostnameFqdn = hostname ? this.cloudflareDnsService.getFqdn(hostname) : undefined;
    const provider = resolveItemProvider(item);
    let serverInfo = item.serverInfoSnapshot
      ? mapServerInfoSnapshotToResponse(item.serverInfoSnapshot, hostname, hostnameFqdn)
      : undefined;

    // Cached snapshots often omit geography; refresh from the provider before config fallback.
    if (!serverInfo || !serverInfoHasGeography(serverInfo.metadata)) {
      try {
        const liveInfo = await this.fetchLiveServerInfo(item);

        if (liveInfo) {
          serverInfo = mapServerInfoToResponse(liveInfo);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.warn(
          `Live server info refresh failed for item ${itemId}; falling back to cached snapshot: ${message}`,
        );
      }
    }

    serverInfo = enrichServerInfoWithConfigGeography(serverInfo, item.configSnapshot, provider);

    if (serverInfo) {
      response.serverInfo = serverInfo;
    }

    const activeAddonRows = await this.subscriptionAddonsRepository.findActiveBySubscriptionId(subscriptionId);
    const activeAddons: ActiveSubscriptionAddonSummaryDto[] = activeAddonRows
      .filter((row) => row.status === 'active' || row.status === 'pending')
      .map((row) => ({
        id: row.id,
        addonId: row.addonId,
        key: row.addon?.key ?? row.addonId,
        name: row.addon?.name ?? row.addonId,
        moduleKey: row.addon?.moduleKey ?? null,
        status: row.status,
      }));
    const tabs: ResolvedServiceDetailTab[] = [createDetailsTab()];
    const tabCtx = { subscriptionId, itemId };

    for (const row of activeAddonRows) {
      if (row.status !== 'active') {
        continue;
      }

      const moduleKey = row.addon?.moduleKey;

      if (!moduleKey || row.addon?.implementationType !== 'module') {
        continue;
      }

      const module = this.addonModuleRegistry.get(moduleKey);

      appendServiceTabs(tabs, module?.serviceTabs, 'addon', moduleKey, tabCtx);
    }

    await this.appendProvisioningContributorTabs(tabs, item, tabCtx);

    response.tabs = sortResolvedServiceTabs(tabs) as ServiceDetailTabDto[];
    response.activeAddons = activeAddons;

    const hasContainerManager = activeAddonRows.some(
      (row) =>
        row.status === 'active' &&
        row.addon?.moduleKey === CONTAINER_MANAGER_MODULE_KEY &&
        row.addon.implementationType === 'module',
    );

    if (hasContainerManager) {
      const cached = await this.containerManagerService.getCachedSummary(itemId);

      response.containerManager = {
        containerCount: cached?.containerCount ?? 0,
        healthyCount: cached?.healthyCount ?? 0,
        lastCollectedAt: cached?.lastCollectedAt ?? null,
      };
    }

    return response;
  }

  private async updateDisplayNameInternal(
    subscriptionId: string,
    itemId: string,
    displayName: string | null,
  ): Promise<SubscriptionItemResponseDto> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (!this.isSubscriptionServiceDetailAccessible(subscription.status)) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    const item = await this.subscriptionItemsRepository.findByIdAndSubscriptionId(itemId, subscriptionId);

    if (!item || !this.isDetailEligible(item.providerReference, item.provisioningStatus)) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    const normalized = this.normalizeDisplayName(displayName);

    await this.subscriptionItemsRepository.updateDisplayName(itemId, normalized);

    this.billingNotificationPublisher.publish(
      'subscription.service.renamed',
      {
        subscriptionId,
        itemId,
        displayName: normalized,
      },
      subscription.userId,
    );

    const refreshed = await this.subscriptionItemsRepository.findByIdAndSubscriptionId(itemId, subscriptionId);

    if (!refreshed) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    return mapSubscriptionItemToResponse(refreshed);
  }

  private async fetchServerInfoForItem(subscriptionId: string, itemId: string): Promise<ServerInfo> {
    const item = await this.subscriptionItemsRepository.findByIdAndSubscriptionId(itemId, subscriptionId);

    if (!item) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    this.assertProvisioned(item.providerReference, item.provisioningStatus);

    const info = await this.fetchLiveServerInfo(item);

    if (!info) {
      throw new BadRequestException('Provider does not support server info');
    }

    return info;
  }

  private async fetchLiveServerInfo(
    item: Awaited<ReturnType<SubscriptionItemsRepository['findByIdAndSubscriptionId']>> & object,
  ): Promise<ServerInfo | undefined> {
    const provider = resolveItemProvider(item);

    if (!provider || !item.providerReference) {
      return undefined;
    }

    const credentials = getProvisioningCredentials(provider, item.serviceType?.providerDefaults);
    const info = await this.provisioningDispatchService.getServerInfo(provider, item.providerReference, credentials);

    if (!info) {
      return undefined;
    }

    const metadata = { ...info.metadata, provider };
    const hostname = item.hostname;
    const hostnameFqdn = hostname ? this.cloudflareDnsService.getFqdn(hostname) : undefined;

    await this.subscriptionItemsRepository.updateServerInfoSnapshot(item.id, {
      serverId: info.serverId,
      name: info.name,
      publicIp: info.publicIp,
      privateIp: info.privateIp,
      status: info.status,
      metadata,
    });

    return { ...info, metadata, hostname, hostnameFqdn };
  }

  private normalizeDisplayName(displayName: string | null): string | null {
    if (displayName == null) {
      return null;
    }

    const trimmed = displayName.trim();

    if (trimmed === '') {
      return null;
    }

    if (trimmed.length > 255) {
      throw new BadRequestException('Display name must be at most 255 characters');
    }

    return trimmed;
  }

  private isDetailEligible(providerReference: string | undefined, status: ProvisioningStatus): boolean {
    return providerReference != null && providerReference !== '' && status === ProvisioningStatus.ACTIVE;
  }

  /** Service details / rename / power remain available while the subscription still owns a live service. */
  private isSubscriptionServiceDetailAccessible(status: SubscriptionStatus): boolean {
    return isLiveAccessibleSubscriptionStatus(status);
  }

  private async resolveItemForAction(subscriptionId: string, itemId: string, userId: string) {
    await this.subscriptionService.getSubscription(subscriptionId, userId);

    return (await this.resolveItemForAdminAction(subscriptionId, itemId)).item;
  }

  private async resolveItemForAdminAction(subscriptionId: string, itemId: string) {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (!this.isSubscriptionServiceDetailAccessible(subscription.status)) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    const item = await this.subscriptionItemsRepository.findByIdAndSubscriptionId(itemId, subscriptionId);

    if (!item) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    this.assertProvisioned(item.providerReference, item.provisioningStatus);

    if (!resolveItemProvider(item)) {
      throw new BadRequestException('Service type has no provider');
    }

    // Webhook `client_id` is the subscription owner (customer), never the acting admin.
    return { item, ownerUserId: subscription.userId };
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

  /**
   * Merges tabs from the item's integrated stack or custom CloudInit config (entity + code module).
   */
  private async appendProvisioningContributorTabs(
    tabs: ResolvedServiceDetailTab[],
    item: { serviceTypeId: string | null; configSnapshot?: Record<string, unknown> },
    ctx: { subscriptionId: string; itemId: string },
  ): Promise<void> {
    if (item.serviceTypeId == null) {
      return;
    }

    const service = normalizeCloudInitService(item.configSnapshot?.['service'] as string | undefined);

    if (service === CloudInitServiceType.None) {
      return;
    }

    if (service === CloudInitServiceType.Custom) {
      const rawConfigId = item.configSnapshot?.['cloudInitConfigId'];
      const cloudInitConfigId = typeof rawConfigId === 'string' ? rawConfigId.trim() : '';

      if (!cloudInitConfigId || !CLOUD_INIT_CONFIG_ID_PATTERN.test(cloudInitConfigId)) {
        return;
      }

      const config = await this.cloudInitConfigsRepository.findById(cloudInitConfigId);

      if (!config) {
        return;
      }

      let declarativeTabs = config.serviceTabs ?? [];

      try {
        declarativeTabs = sanitizeCloudInitServiceTabs(declarativeTabs);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.warn(
          `Ignoring invalid CloudInit serviceTabs on config ${config.id} while building item detail: ${message}`,
        );
        declarativeTabs = [];
      }

      appendServiceTabs(tabs, declarativeTabs, 'cloud-init', config.key, ctx);

      const codeModule = this.cloudInitModuleRegistry.get(config.key);

      appendServiceTabs(tabs, codeModule?.serviceTabs, 'cloud-init', config.key, ctx);

      return;
    }

    const integratedKey = canonicalizeIntegratedProvisioningService(service) ?? (service as string);
    const stackModule = this.integratedStackRegistry.get(integratedKey);

    appendServiceTabs(tabs, stackModule?.serviceTabs, 'integrated', integratedKey, ctx);
  }
}
