import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { BillingIntervalType } from '../entities/service-plan.entity';
import { SubscriptionEntity, SubscriptionStatus } from '../entities/subscription.entity';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import {
  buildBillingCloudInitUserData,
  buildCloudInitConfigFromRequest,
} from '../utils/cloud-init/agent-controller.utils';
import {
  buildAgentManagerCloudInitConfigFromRequest,
  buildAgentManagerCloudInitUserData,
} from '../utils/cloud-init/agent-manager.utils';
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
import { CloudflareDnsService } from './cloudflare-dns.service';
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
    const provider = serviceType.provider;

    if (provider === 'hetzner' || provider === 'digital-ocean') {
      const regionResolved = resolveProvisioningRegion(effectiveConfig, provider);

      mirrorGeographyInConfig(effectiveConfig, regionResolved);
    }

    const validationErrors = validateConfigSchema(serviceType.configSchema, effectiveConfig);

    if (validationErrors.length > 0) {
      throw new BadRequestException(validationErrors.join('; '));
    }

    const service = (effectiveConfig.service as string) ?? 'controller';

    if (service === 'manager' && (effectiveConfig.authenticationMethod as string) === 'users') {
      effectiveConfig.authenticationMethod = 'api-key';
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
        const userData =
          service === 'manager'
            ? buildAgentManagerCloudInitUserData(
                buildAgentManagerCloudInitConfigFromRequest(effectiveConfig, hostname, baseDomain),
              )
            : buildBillingCloudInitUserData(buildCloudInitConfigFromRequest(effectiveConfig, hostname, baseDomain));
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
}
