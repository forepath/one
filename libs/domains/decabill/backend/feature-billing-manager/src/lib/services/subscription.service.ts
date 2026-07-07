import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { SubscriptionResponseDto } from '../dto/subscription-response.dto';
import type { WithdrawalEligibilityDto, WithdrawalResultDto } from '../dto/withdrawal-policy.dto';
import { BillingIntervalType } from '../entities/service-plan.entity';
import { ProvisioningStatus } from '../entities/subscription-item.entity';
import { SubscriptionEntity, SubscriptionStatus } from '../entities/subscription.entity';
import { BackordersRepository } from '../repositories/backorders.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { buildProvisioningUserData, normalizeCloudInitService } from '../utils/cloud-init/cloud-init-dispatch.utils';
import {
  applyResolvedProvisioningSelectionToConfig,
  resolveOrderProvisioningSelection,
} from '../utils/cloud-init/plan-provisioning-options.utils';
import { validateConfigSchema } from '../utils/config-validation.utils';
import {
  mirrorGeographyInConfig,
  resolveProvisioningRegion,
  stripGeographyFromRequestedConfig,
} from '../utils/provider-location.utils';
import { generateSshKeyPair } from '../utils/ssh-key.utils';

import { AvailabilityService } from './availability.service';
import { BackorderService } from './backorder.service';
import { BillingScheduleService } from './billing-schedule.service';
import { CancellationPolicyService } from './cancellation-policy.service';
import { WithdrawalPolicyService } from './withdrawal-policy.service';
import { WithdrawalRefundService } from './withdrawal-refund.service';
import { CloudflareDnsService } from './cloudflare-dns.service';
import { CloudInitConfigService } from './cloud-init-config.service';
import { CustomerProfilesService } from './customer-profiles.service';
import { HostnameReservationService } from './hostname-reservation.service';
import { ProvisioningService } from './provisioning.service';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly serviceTypesRepository: ServiceTypesRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly billingScheduleService: BillingScheduleService,
    private readonly cancellationPolicyService: CancellationPolicyService,
    private readonly backorderService: BackorderService,
    private readonly availabilityService: AvailabilityService,
    private readonly provisioningService: ProvisioningService,
    private readonly hostnameReservationService: HostnameReservationService,
    private readonly cloudflareDnsService: CloudflareDnsService,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly cloudInitConfigService: CloudInitConfigService,
    private readonly withdrawalPolicyService: WithdrawalPolicyService,
    private readonly withdrawalRefundService: WithdrawalRefundService,
    private readonly backordersRepository: BackordersRepository,
  ) {}

  async createSubscription(
    userId: string,
    planId: string,
    requestedConfig?: Record<string, unknown>,
    autoBackorder = false,
  ) {
    const profile = await this.customerProfilesService.getByUserId(userId);

    if (!this.customerProfilesService.isProfileComplete(profile)) {
      throw new BadRequestException(
        'Customer billing profile must be complete before ordering. Please complete your profile.',
      );
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(planId);
    const serviceType = await this.serviceTypesRepository.findByIdOrThrow(plan.serviceTypeId);
    const allowCustomerLocationSelection = plan.allowCustomerLocationSelection === true;
    const sanitizedRequested = allowCustomerLocationSelection
      ? { ...(requestedConfig ?? {}) }
      : stripGeographyFromRequestedConfig(requestedConfig);
    const baseConfig = plan.providerConfigDefaults ?? {};
    const effectiveConfig: Record<string, unknown> = {
      ...(baseConfig || {}),
      ...sanitizedRequested,
    };

    try {
      const selection = resolveOrderProvisioningSelection(baseConfig, sanitizedRequested);

      applyResolvedProvisioningSelectionToConfig(effectiveConfig, selection);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const provider = serviceType.provider;

    if (provider === 'hetzner' || provider === 'digital-ocean') {
      const regionResolved = resolveProvisioningRegion(effectiveConfig, provider);

      mirrorGeographyInConfig(effectiveConfig, regionResolved);
    }

    const validationErrors = validateConfigSchema(serviceType.configSchema, effectiveConfig);

    if (validationErrors.length > 0) {
      throw new BadRequestException(validationErrors.join('; '));
    }

    const service = normalizeCloudInitService(effectiveConfig.service as string | undefined);

    if (service === 'manager' && (effectiveConfig.authenticationMethod as string) === 'users') {
      effectiveConfig.authenticationMethod = 'api-key';
    }

    let customTemplate;
    let resolvedCustomEnv: Record<string, string> | undefined;

    if (service === 'custom') {
      const cloudInitConfigId = effectiveConfig.cloudInitConfigId as string | undefined;

      if (!cloudInitConfigId?.trim()) {
        throw new BadRequestException('cloudInitConfigId is required when service is custom');
      }

      customTemplate = await this.cloudInitConfigService.findByIdForProvisioning(cloudInitConfigId.trim());
      const requestedEnv = (sanitizedRequested?.['env'] ?? effectiveConfig['env']) as
        | Record<string, unknown>
        | undefined;

      resolvedCustomEnv = this.cloudInitConfigService.resolveEnvironmentVariables(customTemplate, requestedEnv);
      effectiveConfig.env = resolvedCustomEnv;
    }

    const region = resolveProvisioningRegion(effectiveConfig, provider);
    const serverType =
      (effectiveConfig.serverType as string | undefined) ?? (provider === 'digital-ocean' ? 's-1vcpu-1gb' : 'cx11');
    const availability = await this.availabilityService.checkAvailability(provider, region, serverType);

    if (!availability.isAvailable) {
      if (autoBackorder) {
        await this.backorderService.create({
          userId,
          serviceTypeId: plan.serviceTypeId,
          planId,
          requestedConfigSnapshot: sanitizedRequested,
          providerErrors: { reason: availability.reason },
          preferredAlternatives: availability.alternatives ?? {},
        });
      }

      throw new BadRequestException(availability.reason || 'Configuration not available');
    }

    const schedule = this.billingScheduleService.calculateSchedule(
      plan.billingIntervalType as BillingIntervalType,
      plan.billingIntervalValue,
      plan.billingDayOfMonth,
    );
    const subscription = await this.subscriptionsRepository.create({
      userId,
      planId,
      status: SubscriptionStatus.ACTIVE,
      autoBackorder,
      currentPeriodStart: schedule.currentPeriodStart,
      currentPeriodEnd: schedule.currentPeriodEnd,
      nextBillingAt: schedule.nextBillingAt,
    });

    // The order is recorded synchronously with the item left pending; the actual server
    // provisioning is handed to the provisioning queue (see provisionSubscriptionItem),
    // mirroring the deferred teardown/withdrawal flows.
    await this.subscriptionItemsRepository.create({
      subscriptionId: subscription.id,
      serviceTypeId: plan.serviceTypeId,
      configSnapshot: effectiveConfig,
    });

    // Reload so DB-generated columns (e.g. the sequence-backed `number`) are populated on the
    // returned entity; save() does not reliably hydrate database defaults.
    return await this.subscriptionsRepository.findByIdOrThrow(subscription.id);
  }

  /**
   * Provisions the server for a pending subscription item. Invoked asynchronously by the
   * provisioning coordinator/unit jobs. Idempotent and self-guarding: it skips items that are
   * no longer pending, already have a provider reference, or whose subscription is not active.
   * On failure it rolls back the half-created order (and optionally backorders) when no server
   * was created, or marks the item failed when a server already exists.
   */
  async provisionSubscriptionItem(itemId: string): Promise<void> {
    const item = await this.subscriptionItemsRepository.findByIdWithRelations(itemId);

    if (!item) {
      this.logger.warn(`Provisioning skipped; subscription item ${itemId} not found`);

      return;
    }

    if (item.provisioningStatus !== ProvisioningStatus.PENDING || item.providerReference) {
      this.logger.log(`Skipping provisioning for item ${itemId}; status is ${item.provisioningStatus}`);

      return;
    }

    const subscription = item.subscription;
    const provider = item.serviceType?.provider;

    if (!subscription || subscription.status !== SubscriptionStatus.ACTIVE) {
      this.logger.log(`Skipping provisioning for item ${itemId}; subscription is not active`);

      return;
    }

    if (provider !== 'hetzner' && provider !== 'digital-ocean') {
      // Nothing to provision for non-server providers; treat the item as fulfilled.
      await this.subscriptionItemsRepository.updateProvisioningStatus(itemId, 'active');

      return;
    }

    const effectiveConfig: Record<string, unknown> = { ...(item.configSnapshot ?? {}) };
    const region = resolveProvisioningRegion(effectiveConfig, provider);

    mirrorGeographyInConfig(effectiveConfig, region);

    if (!effectiveConfig.serverType) {
      effectiveConfig.serverType = provider === 'digital-ocean' ? 's-1vcpu-1gb' : 'cx11';
    }

    const serverType = effectiveConfig.serverType as string;
    const service = normalizeCloudInitService(effectiveConfig.service as string | undefined);

    let customTemplate;
    let resolvedCustomEnv: Record<string, string> | undefined;

    if (service === 'custom') {
      const cloudInitConfigId = (effectiveConfig.cloudInitConfigId as string | undefined)?.trim();

      if (cloudInitConfigId) {
        customTemplate = await this.cloudInitConfigService.findByIdForProvisioning(cloudInitConfigId);
        resolvedCustomEnv = effectiveConfig.env as Record<string, string> | undefined;
      }
    }

    let hostname: string | null = null;
    let provisionedServerId: string | undefined;

    try {
      hostname = await this.hostnameReservationService.reserveHostname(itemId);
      const { publicKey, privateKey } = generateSshKeyPair();

      await this.subscriptionItemsRepository.updateSshPrivateKey(itemId, privateKey);
      effectiveConfig.sshPublicKey = publicKey;
      const baseDomain = process.env.DNS_BASE_DOMAIN ?? 'spirde.com';
      const userData = buildProvisioningUserData({
        service,
        effectiveConfig,
        hostname,
        baseDomain,
        customTemplate,
        resolvedCustomEnv,
      });
      const provisioned = await this.provisioningService.provision(provider, {
        name: hostname,
        serverType,
        location: region,
        firewallId: effectiveConfig.firewallId as number | undefined,
        userData,
      });

      provisionedServerId = provisioned?.serverId;

      if (provisioned?.serverId) {
        await this.subscriptionItemsRepository.updateProviderReference(itemId, provisioned.serverId);
        await this.subscriptionItemsRepository.updateProvisioningStatus(itemId, 'active');
        const serverInfo = await this.provisioningService.getServerInfo(provider, provisioned.serverId);
        const publicIp = await this.provisioningService.ensurePublicIpForDns(
          provider,
          provisioned.serverId,
          serverInfo,
        );

        if (publicIp) {
          try {
            await this.cloudflareDnsService.createARecord(hostname, publicIp);
          } catch (dnsError) {
            this.logger.warn(
              `DNS record creation failed for ${hostname}, server provisioned with IP ${publicIp}: ${(dnsError as Error).message}`,
            );
          }
        }
      }

      this.logger.log(`Provisioned subscription item ${itemId}`);
    } catch (error) {
      if (hostname) {
        try {
          await this.hostnameReservationService.releaseHostname(itemId);
        } catch (releaseError) {
          this.logger.warn(`Failed to release hostname after provisioning failure: ${(releaseError as Error).message}`);
        }
      }

      // A real server was created before the failure (e.g. a post-provision call threw). Keep the
      // records so the server stays tracked for teardown, and do not backorder (it already exists).
      if (provisionedServerId) {
        await this.subscriptionItemsRepository.updateProvisioningStatus(itemId, 'failed');
        this.logger.error(`Provisioning item ${itemId} failed after server creation: ${(error as Error).message}`);

        return;
      }

      // No server was provisioned: roll back the half-created order so no dangling active
      // subscription remains, matching the out-of-stock path (only a backorder is left behind).
      try {
        await this.subscriptionItemsRepository.delete(itemId);
        await this.subscriptionsRepository.delete(subscription.id);
      } catch (rollbackError) {
        this.logger.warn(
          `Failed to roll back subscription ${subscription.id} after provisioning failure: ${(rollbackError as Error).message}`,
        );
      }

      if (subscription.autoBackorder) {
        await this.backorderService.create({
          userId: subscription.userId,
          serviceTypeId: item.serviceTypeId,
          planId: subscription.planId,
          requestedConfigSnapshot: effectiveConfig,
          providerErrors: { reason: (error as Error).message },
        });
      }

      this.logger.error(`Provisioning item ${itemId} failed: ${(error as Error).message}`);
    }
  }

  async listSubscriptions(userId: string, limit: number, offset: number) {
    return await this.subscriptionsRepository.findAllByUser(userId, limit, offset);
  }

  async getSubscription(subscriptionId: string, userId: string) {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (subscription.userId !== userId) {
      throw new BadRequestException('Subscription does not belong to user');
    }

    return subscription;
  }

  async cancelSubscription(subscriptionId: string, userId: string): Promise<SubscriptionEntity> {
    const subscription = await this.getSubscription(subscriptionId, userId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const decision = this.cancellationPolicyService.evaluate(
      subscription.createdAt,
      subscription.currentPeriodEnd,
      plan.cancelAtPeriodEnd,
      plan.minCommitmentDays,
      plan.noticeDays,
    );

    if (!decision.canCancel) {
      throw new BadRequestException(decision.reason || 'Cancellation not permitted');
    }

    return await this.subscriptionsRepository.update(subscriptionId, {
      status: SubscriptionStatus.PENDING_CANCEL,
      cancelRequestedAt: new Date(),
      cancelEffectiveAt: decision.effectiveAt,
    });
  }

  async resumeSubscription(subscriptionId: string, userId: string): Promise<SubscriptionEntity> {
    const subscription = await this.getSubscription(subscriptionId, userId);

    if (subscription.status !== SubscriptionStatus.PENDING_CANCEL) {
      throw new BadRequestException('Subscription is not pending cancel');
    }

    return await this.subscriptionsRepository.update(subscriptionId, {
      status: SubscriptionStatus.ACTIVE,
      resumedAt: new Date(),
      cancelRequestedAt: null,
      cancelEffectiveAt: null,
    });
  }

  async withdrawSubscription(
    subscriptionId: string,
    userId: string,
  ): Promise<{ subscription: SubscriptionEntity; withdrawalResult?: WithdrawalResultDto }> {
    await this.getSubscription(subscriptionId, userId);

    return this.executeWithdrawal(subscriptionId);
  }

  async executeWithdrawal(
    subscriptionId: string,
  ): Promise<{ subscription: SubscriptionEntity; withdrawalResult?: WithdrawalResultDto }> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const serviceType = await this.serviceTypesRepository.findByIdOrThrow(plan.serviceTypeId);
    const items = await this.subscriptionItemsRepository.findBySubscription(subscriptionId);
    const decision = this.withdrawalPolicyService.evaluate({
      subscriptionStatus: subscription.status,
      items,
      serviceType,
    });

    if (!decision.canWithdraw) {
      throw new BadRequestException(decision.reason || 'Withdrawal not permitted');
    }

    await this.backordersRepository.cancelPendingForUserPlan(subscription.userId, subscription.planId);

    const withdrawnAt = new Date();
    const phase = decision.phase === 'withdrawal_period' ? 'withdrawal_period' : 'unprovisioned';
    let estimatedRefundGross: number | undefined;

    if (phase === 'withdrawal_period') {
      estimatedRefundGross = await this.withdrawalRefundService.estimateRefundGross(subscription);
    }

    // Record the withdrawal and hand teardown (deprovision + refund) to the queue,
    // mirroring the pending_cancel expiration flow. The refund is applied when the
    // withdrawal unit job runs, so the response returns an estimate, not the final credit.
    await this.subscriptionsRepository.update(subscriptionId, {
      status: SubscriptionStatus.PENDING_WITHDRAWAL,
      withdrawnAt,
      withdrawPhase: phase,
    });

    const updated = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const withdrawalResult: WithdrawalResultDto = {
      refundGross: estimatedRefundGross,
      paymentRefundStatus: estimatedRefundGross ? 'pending' : 'not_applicable',
    };

    return { subscription: updated, withdrawalResult };
  }

  async mapToResponse(
    subscription: SubscriptionEntity,
    items = [] as Awaited<ReturnType<SubscriptionItemsRepository['findBySubscription']>>,
    serviceType?: Awaited<ReturnType<ServiceTypesRepository['findByIdOrThrow']>>,
    withdrawalResult?: WithdrawalResultDto,
  ): Promise<SubscriptionResponseDto> {
    let eligibility: WithdrawalEligibilityDto | undefined;

    if (serviceType) {
      const decision = this.withdrawalPolicyService.evaluate({
        subscriptionStatus: subscription.status,
        items,
        serviceType,
      });
      let estimatedRefundGross: number | undefined;

      if (decision.phase === 'withdrawal_period') {
        estimatedRefundGross = await this.withdrawalRefundService.estimateRefundGross(subscription);
      }

      eligibility = {
        canWithdraw: decision.canWithdraw,
        phase: decision.phase,
        deadline: decision.deadline,
        reason: decision.reason,
        estimatedRefundGross,
      };
    }

    return {
      id: subscription.id,
      number: subscription.number,
      planId: subscription.planId,
      userId: subscription.userId,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      nextBillingAt: subscription.nextBillingAt,
      cancelRequestedAt: subscription.cancelRequestedAt,
      cancelEffectiveAt: subscription.cancelEffectiveAt,
      resumedAt: subscription.resumedAt,
      withdrawnAt: subscription.withdrawnAt,
      withdrawalEligibility: eligibility,
      withdrawalResult,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    };
  }

  async mapManyToResponses(subscriptions: SubscriptionEntity[]): Promise<SubscriptionResponseDto[]> {
    if (subscriptions.length === 0) {
      return [];
    }

    const subscriptionIds = subscriptions.map((s) => s.id);
    const items = await this.subscriptionItemsRepository.findBySubscriptionIds(subscriptionIds);
    const itemsBySubscription = new Map<string, typeof items>();

    for (const item of items) {
      const list = itemsBySubscription.get(item.subscriptionId) ?? [];

      list.push(item);
      itemsBySubscription.set(item.subscriptionId, list);
    }

    const planIds = [...new Set(subscriptions.map((s) => s.planId))];
    const serviceTypesByPlan = new Map<string, Awaited<ReturnType<ServiceTypesRepository['findByIdOrThrow']>>>();

    for (const planId of planIds) {
      const plan = await this.servicePlansRepository.findByIdOrThrow(planId);
      const serviceType = await this.serviceTypesRepository.findByIdOrThrow(plan.serviceTypeId);

      serviceTypesByPlan.set(planId, serviceType);
    }

    return await Promise.all(
      subscriptions.map((subscription) =>
        this.mapToResponse(
          subscription,
          itemsBySubscription.get(subscription.id) ?? [],
          serviceTypesByPlan.get(subscription.planId),
        ),
      ),
    );
  }
}
