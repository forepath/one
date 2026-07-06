import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { SubscriptionResponseDto } from '../dto/subscription-response.dto';
import type { WithdrawalEligibilityDto, WithdrawalResultDto } from '../dto/withdrawal-policy.dto';
import { BillingIntervalType } from '../entities/service-plan.entity';
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
import { SubscriptionTeardownService } from './subscription-teardown.service';
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
    private readonly subscriptionTeardownService: SubscriptionTeardownService,
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
      currentPeriodStart: schedule.currentPeriodStart,
      currentPeriodEnd: schedule.currentPeriodEnd,
      nextBillingAt: schedule.nextBillingAt,
    });
    const subscriptionItem = await this.subscriptionItemsRepository.create({
      subscriptionId: subscription.id,
      serviceTypeId: plan.serviceTypeId,
      configSnapshot: effectiveConfig,
    });

    if (serviceType.provider === 'hetzner' || serviceType.provider === 'digital-ocean') {
      let hostname: string | null = null;

      try {
        hostname = await this.hostnameReservationService.reserveHostname(subscriptionItem.id);
        const { publicKey, privateKey } = generateSshKeyPair();

        await this.subscriptionItemsRepository.updateSshPrivateKey(subscriptionItem.id, privateKey);
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
        const provisioningConfig = {
          name: hostname,
          serverType,
          location: region,
          firewallId: effectiveConfig.firewallId as number | undefined,
          userData,
        };
        const provisioned = await this.provisioningService.provision(serviceType.provider, provisioningConfig);

        if (provisioned?.serverId) {
          await this.subscriptionItemsRepository.updateProviderReference(subscriptionItem.id, provisioned.serverId);
          await this.subscriptionItemsRepository.updateProvisioningStatus(subscriptionItem.id, 'active');
          const serverInfo = await this.provisioningService.getServerInfo(serviceType.provider, provisioned.serverId);
          const publicIp = await this.provisioningService.ensurePublicIpForDns(
            serviceType.provider,
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
      } catch (error) {
        if (hostname) {
          try {
            await this.hostnameReservationService.releaseHostname(subscriptionItem.id);
          } catch (releaseError) {
            this.logger.warn(
              `Failed to release hostname after provisioning failure: ${(releaseError as Error).message}`,
            );
          }
        }

        await this.subscriptionItemsRepository.updateProvisioningStatus(subscriptionItem.id, 'failed');

        if (autoBackorder) {
          await this.backorderService.create({
            userId,
            serviceTypeId: plan.serviceTypeId,
            planId,
            requestedConfigSnapshot: effectiveConfig,
            providerErrors: { reason: (error as Error).message },
          });
        }

        throw error;
      }
    }

    if (autoBackorder) {
      await this.backorderService.create({
        userId,
        serviceTypeId: plan.serviceTypeId,
        planId,
        requestedConfigSnapshot: effectiveConfig,
      });
    }

    return subscription;
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
    const subscription = await this.getSubscription(subscriptionId, userId);
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

    await this.backordersRepository.cancelPendingForUserPlan(userId, subscription.planId);

    const withdrawnAt = new Date();
    let withdrawalResult: WithdrawalResultDto | undefined;

    if (decision.phase === 'withdrawal_period') {
      withdrawalResult = await this.withdrawalRefundService.applyProvisionedWithdrawalRefund(subscription, withdrawnAt);
    }

    await this.subscriptionTeardownService.teardownImmediate(subscriptionId, {
      withdrawn: true,
      billUntil: withdrawnAt,
      ...(decision.phase === 'unprovisioned' ? { skipOpenPosition: true } : {}),
    });

    const updated = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

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
