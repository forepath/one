import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { BackorderEntity, BackorderStatus } from '../entities/backorder.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';
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
import { getProvisioningCredentials, normalizeStoredProviderDefaults } from '../utils/provider-env-defaults.utils';
import { generateSshKeyPair } from '../utils/ssh-key.utils';

import { AvailabilityService } from './availability.service';
import { BillingScheduleService } from './billing-schedule.service';
import { CloudInitConfigService } from './cloud-init-config.service';
import { CloudflareDnsService } from './cloudflare-dns.service';
import { HostnameReservationService } from './hostname-reservation.service';
import { ProvisioningService } from './provisioning.service';

@Injectable()
export class BackorderService {
  private readonly logger = new Logger(BackorderService.name);

  constructor(
    private readonly backordersRepository: BackordersRepository,
    private readonly availabilityService: AvailabilityService,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly serviceTypesRepository: ServiceTypesRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly billingScheduleService: BillingScheduleService,
    private readonly provisioningService: ProvisioningService,
    private readonly hostnameReservationService: HostnameReservationService,
    private readonly cloudflareDnsService: CloudflareDnsService,
    private readonly cloudInitConfigService: CloudInitConfigService,
  ) {}

  async create(data: {
    userId: string;
    serviceTypeId: string;
    planId: string;
    requestedConfigSnapshot: Record<string, unknown>;
    providerErrors?: Record<string, unknown>;
    preferredAlternatives?: Record<string, unknown>;
  }): Promise<BackorderEntity> {
    return await this.backordersRepository.create({
      userId: data.userId,
      serviceTypeId: data.serviceTypeId,
      planId: data.planId,
      requestedConfigSnapshot: data.requestedConfigSnapshot,
      providerErrors: data.providerErrors ?? {},
      preferredAlternatives: data.preferredAlternatives ?? {},
      status: BackorderStatus.PENDING,
    });
  }

  async listForUser(userId: string, limit: number, offset: number): Promise<BackorderEntity[]> {
    return await this.backordersRepository.findAllByUser(userId, limit, offset);
  }

  async cancel(backorderId: string): Promise<BackorderEntity> {
    const backorder = await this.backordersRepository.findByIdOrThrow(backorderId);

    if (backorder.status !== BackorderStatus.PENDING && backorder.status !== BackorderStatus.RETRYING) {
      throw new BadRequestException('Only pending backorders can be cancelled');
    }

    return await this.backordersRepository.update(backorderId, { status: BackorderStatus.CANCELLED });
  }

  async markRetrying(backorderId: string): Promise<BackorderEntity> {
    return await this.backordersRepository.update(backorderId, { status: BackorderStatus.RETRYING });
  }

  async retry(backorderId: string): Promise<BackorderEntity> {
    const backorder = await this.backordersRepository.findByIdOrThrow(backorderId);

    // A backorder may have been cancelled (e.g. via subscription withdrawal/cancellation) or already
    // resolved between coordinator enqueue and this unit job. Never provision a non-actionable backorder,
    // otherwise a customer who withdrew or cancelled could still get a server created.
    if (backorder.status !== BackorderStatus.PENDING && backorder.status !== BackorderStatus.RETRYING) {
      this.logger.log(`Skipping backorder ${backorderId}; status is ${backorder.status}`);

      return backorder;
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(backorder.planId);
    const serviceType = await this.serviceTypesRepository.findByIdOrThrow(plan.serviceTypeId);
    const allowCustomerLocationSelection = plan.allowCustomerLocationSelection === true;
    const sanitizedSnapshot = allowCustomerLocationSelection
      ? { ...(backorder.requestedConfigSnapshot ?? {}) }
      : stripGeographyFromRequestedConfig(backorder.requestedConfigSnapshot);
    const effectiveConfig: Record<string, unknown> = {
      ...(plan.providerConfigDefaults ?? {}),
      ...sanitizedSnapshot,
    };

    try {
      const selection = resolveOrderProvisioningSelection(plan.providerConfigDefaults ?? {}, sanitizedSnapshot);

      applyResolvedProvisioningSelectionToConfig(effectiveConfig, selection);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const provider = serviceType.provider;

    if (provider === 'hetzner' || provider === 'digital-ocean') {
      const regionResolved = resolveProvisioningRegion(effectiveConfig, provider);

      mirrorGeographyInConfig(effectiveConfig, regionResolved);
    }

    if (!effectiveConfig.serverType) {
      effectiveConfig.serverType = provider === 'digital-ocean' ? 's-1vcpu-1gb' : 'cx11';
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
      const requestedEnv = (sanitizedSnapshot?.['env'] ?? effectiveConfig['env']) as
        | Record<string, unknown>
        | undefined;

      resolvedCustomEnv = this.cloudInitConfigService.resolveEnvironmentVariables(customTemplate, requestedEnv);
      effectiveConfig.env = resolvedCustomEnv;
    }

    const region = resolveProvisioningRegion(effectiveConfig, provider);
    const serverType = effectiveConfig.serverType as string;
    const providerDefaults = normalizeStoredProviderDefaults(serviceType.providerDefaults);
    const availability = await this.availabilityService.checkAvailability(
      provider,
      region,
      serverType,
      providerDefaults,
    );

    if (!availability.isAvailable) {
      return await this.backordersRepository.update(backorderId, {
        status: BackorderStatus.RETRYING,
        failureReason: availability.reason,
        preferredAlternatives: availability.alternatives ?? {},
      });
    }

    const schedule = this.billingScheduleService.calculateSchedule(
      plan.billingIntervalType,
      plan.billingIntervalValue,
      plan.billingDayOfMonth,
    );
    const subscription = await this.subscriptionsRepository.create({
      userId: backorder.userId,
      planId: backorder.planId,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: schedule.currentPeriodStart,
      currentPeriodEnd: schedule.currentPeriodEnd,
      nextBillingAt: schedule.nextBillingAt,
    });
    const baseItem = await this.subscriptionItemsRepository.create({
      subscriptionId: subscription.id,
      serviceTypeId: plan.serviceTypeId,
      configSnapshot: { ...effectiveConfig },
    });

    if (serviceType.provider === 'hetzner' || serviceType.provider === 'digital-ocean') {
      let hostname: string | null = null;
      const credentials = getProvisioningCredentials(serviceType.provider, serviceType.providerDefaults);

      try {
        hostname = await this.hostnameReservationService.reserveHostname(baseItem.id);
        const { publicKey, privateKey } = generateSshKeyPair();

        await this.subscriptionItemsRepository.updateSshPrivateKey(baseItem.id, privateKey);
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
          serverType: effectiveConfig.serverType as string,
          location: region,
          firewallId: effectiveConfig.firewallId as number | undefined,
          userData,
        };
        const provisioned = await this.provisioningService.provision(
          serviceType.provider,
          provisioningConfig,
          credentials,
        );

        if (provisioned?.serverId) {
          await this.subscriptionItemsRepository.updateProviderReference(baseItem.id, provisioned.serverId);
          await this.subscriptionItemsRepository.updateProvisioningStatus(baseItem.id, 'active');
          const serverInfo = await this.provisioningService.getServerInfo(
            serviceType.provider,
            provisioned.serverId,
            credentials,
          );
          const publicIp = await this.provisioningService.ensurePublicIpForDns(
            serviceType.provider,
            provisioned.serverId,
            serverInfo,
            credentials,
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
            await this.hostnameReservationService.releaseHostname(baseItem.id);
          } catch (releaseError) {
            this.logger.warn(
              `Failed to release hostname after provisioning failure: ${(releaseError as Error).message}`,
            );
          }
        }

        await this.subscriptionItemsRepository.updateProvisioningStatus(baseItem.id, 'failed');
        throw error;
      }
    }

    return await this.backordersRepository.update(backorderId, { status: BackorderStatus.FULFILLED });
  }
}
