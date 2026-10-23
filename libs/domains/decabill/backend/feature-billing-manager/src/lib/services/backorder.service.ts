import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { BackorderResponseDto } from '../dto/backorder-response.dto';
import { BackorderEntity, BackorderStatus } from '../entities/backorder.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { BackordersRepository } from '../repositories/backorders.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { CloudInitDispatchService } from './cloud-init-dispatch.service';
import { normalizeCloudInitService } from '../utils/cloud-init/cloud-init-dispatch.utils';
import { CloudInitServiceType } from '../utils/cloud-init/integrated-provisioning-service';
import {
  applyResolvedProvisioningSelectionToConfig,
  resolveOrderProvisioningSelection,
} from '../utils/cloud-init/plan-provisioning-options.utils';
import { validateConfigSchema } from '../utils/config-validation.utils';
import {
  mirrorGeographyInConfig,
  readRequestedGeography,
  resolveDefaultGeographyForProvider,
  resolveProvisioningRegion,
  stripGeographyByProviderFromConfig,
  stripGeographyFromRequestedConfig,
} from '../utils/provider-location.utils';
import {
  assertServerTypeAllowed,
  normalizeAllowedServerTypes,
  resolveDefaultServerTypeForProvider,
  stripServerTypeByProviderFromConfig,
  stripServerTypeFromRequestedConfig,
} from '../utils/provider-server-type.utils';
import {
  assertProviderAllowed,
  resolveEffectiveProvider,
  resolvePlanAllowedProviders,
  resolveServiceTypeAllowedProviders,
  stripProviderFromRequestedConfig,
} from '../utils/provider-selection.utils';
import {
  BILLING_BASE_PRICE_CONFIG_KEY,
  resolvePeriodTotalPrice,
  resolveServerTypePriceMonthly,
} from '../utils/server-type-billing.utils';
import { getProvisioningCredentials, normalizeStoredProviderDefaults } from '../utils/provider-env-defaults.utils';
import { generateSshKeyPair } from '../utils/ssh-key.utils';

import { AvailabilityService } from './availability.service';
import { BillingScheduleService } from './billing-schedule.service';
import { CloudInitConfigService } from './cloud-init-config.service';
import { CloudflareDnsService } from './cloudflare-dns.service';
import { HostnameReservationService } from './hostname-reservation.service';
import { ProviderServerTypesService } from './provider-server-types.service';
import { PricingService } from './pricing.service';
import { ProviderCatalogDispatchService } from './provider-catalog-dispatch.service';
import { ProviderRegistryService } from './provider-registry.service';
import { ProvisioningDispatchService } from './provisioning-dispatch.service';
import { TaxCalculationService } from './tax-calculation.service';
import { InvoiceTaxContextService } from './invoice-tax-context.service';
import { SubscriptionPeriodChargeService } from './subscription-period-charge.service';

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
    private readonly provisioningDispatchService: ProvisioningDispatchService,
    private readonly hostnameReservationService: HostnameReservationService,
    private readonly cloudflareDnsService: CloudflareDnsService,
    private readonly cloudInitConfigService: CloudInitConfigService,
    private readonly providerServerTypesService: ProviderServerTypesService,
    private readonly pricingService: PricingService,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly subscriptionPeriodChargeService: SubscriptionPeriodChargeService,
    private readonly cloudInitDispatchService: CloudInitDispatchService,
    private readonly providerCatalogDispatchService: ProviderCatalogDispatchService,
    private readonly providerRegistry: ProviderRegistryService,
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

  async listForUser(userId: string, limit: number, offset: number, search?: string): Promise<BackorderEntity[]> {
    return await this.backordersRepository.findAllByUser(userId, limit, offset, search);
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
    const allowCustomerServerTypeSelection = plan.allowCustomerServerTypeSelection === true;
    const allowCustomerProviderSelection = plan.allowCustomerProviderSelection === true;
    let sanitizedSnapshot = allowCustomerLocationSelection
      ? { ...(backorder.requestedConfigSnapshot ?? {}) }
      : stripGeographyFromRequestedConfig(backorder.requestedConfigSnapshot);
    sanitizedSnapshot = allowCustomerServerTypeSelection
      ? sanitizedSnapshot
      : stripServerTypeFromRequestedConfig(sanitizedSnapshot);
    sanitizedSnapshot = allowCustomerProviderSelection
      ? sanitizedSnapshot
      : stripProviderFromRequestedConfig(sanitizedSnapshot);
    const baseConfig = plan.providerConfigDefaults ?? {};
    const effectiveConfig: Record<string, unknown> = {
      ...(baseConfig || {}),
      ...sanitizedSnapshot,
    };

    stripServerTypeByProviderFromConfig(effectiveConfig);
    stripGeographyByProviderFromConfig(effectiveConfig);

    try {
      const selection = resolveOrderProvisioningSelection(plan.providerConfigDefaults ?? {}, sanitizedSnapshot);

      applyResolvedProvisioningSelectionToConfig(effectiveConfig, selection);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    if (allowCustomerProviderSelection) {
      const requestedProvider =
        typeof sanitizedSnapshot['provider'] === 'string' ? sanitizedSnapshot['provider'].trim() : '';

      if (requestedProvider) {
        const allowedError = assertProviderAllowed(requestedProvider, resolvePlanAllowedProviders(plan, serviceType));

        if (allowedError) {
          throw new BadRequestException(allowedError);
        }
      }
    }

    const provider = resolveEffectiveProvider(serviceType, plan, sanitizedSnapshot);
    const primaryForProvisioningCheck = resolveServiceTypeAllowedProviders(serviceType)[0] ?? undefined;

    if (!provider && this.providerCatalogDispatchService.requiresProvisioning(primaryForProvisioningCheck)) {
      throw new BadRequestException('provider could not be resolved for this service type');
    }

    if (provider) {
      effectiveConfig.provider = provider;
    }

    if (provider && this.providerCatalogDispatchService.requiresProvisioning(provider)) {
      const planDefaultGeo = resolveDefaultGeographyForProvider(baseConfig, provider);
      const requestedGeo = readRequestedGeography(sanitizedSnapshot);
      const geography = allowCustomerLocationSelection
        ? requestedGeo || planDefaultGeo || resolveProvisioningRegion({}, provider)
        : planDefaultGeo || resolveProvisioningRegion({}, provider);

      mirrorGeographyInConfig(effectiveConfig, geography);
    }

    const planDefaultServerType = resolveDefaultServerTypeForProvider(baseConfig, provider);
    const requestedServerType =
      typeof sanitizedSnapshot['serverType'] === 'string' ? sanitizedSnapshot['serverType'].trim() : '';

    if (allowCustomerServerTypeSelection) {
      const allowed = normalizeAllowedServerTypes(plan.allowedServerTypes);
      const resolvedServerType = String(
        requestedServerType || planDefaultServerType || (provider === 'digital-ocean' ? 's-1vcpu-1gb' : 'cx11'),
      );
      const serverTypeError = assertServerTypeAllowed(resolvedServerType, allowed);

      if (serverTypeError) {
        throw new BadRequestException(serverTypeError);
      }

      effectiveConfig.serverType = resolvedServerType.trim();
    } else if (provider) {
      effectiveConfig.serverType = planDefaultServerType ?? (provider === 'digital-ocean' ? 's-1vcpu-1gb' : 'cx11');
    }

    const schemaForValidation =
      (provider ? this.providerRegistry.getProvider(provider)?.configSchema : undefined) ?? serviceType.configSchema;
    const validationErrors = validateConfigSchema(schemaForValidation, effectiveConfig);

    if (validationErrors.length > 0) {
      throw new BadRequestException(validationErrors.join('; '));
    }

    const service = normalizeCloudInitService(effectiveConfig.service as string | undefined);

    if (
      service === CloudInitServiceType.AgenstraManager &&
      (effectiveConfig.authenticationMethod as string) === 'users'
    ) {
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

    const region = provider ? resolveProvisioningRegion(effectiveConfig, provider) : '';
    const serverType = effectiveConfig.serverType as string;
    const providerDefaults = normalizeStoredProviderDefaults(serviceType.providerDefaults);

    if (provider && this.providerCatalogDispatchService.requiresProvisioning(provider)) {
      if (allowCustomerServerTypeSelection) {
        const billingBasePrice = await resolveServerTypePriceMonthly(
          this.providerServerTypesService,
          provider,
          serverType,
          providerDefaults,
        );

        if (billingBasePrice != null) {
          effectiveConfig[BILLING_BASE_PRICE_CONFIG_KEY] = billingBasePrice;
        }
      }

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

    if (provider && this.providerCatalogDispatchService.requiresProvisioning(provider)) {
      let hostname: string | null = null;
      const credentials = getProvisioningCredentials(provider, serviceType.providerDefaults);

      try {
        hostname = await this.hostnameReservationService.reserveHostname(baseItem.id);
        const { publicKey, privateKey } = generateSshKeyPair();

        await this.subscriptionItemsRepository.updateSshPrivateKey(baseItem.id, privateKey);
        effectiveConfig.sshPublicKey = publicKey;
        const stackSecrets = this.cloudInitDispatchService.prepareProvisioningConfig(
          effectiveConfig.service as string | undefined,
        );

        if (Object.keys(stackSecrets).length > 0) {
          Object.assign(effectiveConfig, stackSecrets);
          await this.subscriptionItemsRepository.updateConfigSnapshot(baseItem.id, {
            ...(baseItem.configSnapshot ?? {}),
            ...stackSecrets,
          });
        }

        const baseDomain = process.env.DNS_BASE_DOMAIN ?? 'spirde.com';
        const userData = this.cloudInitDispatchService.buildUserData({
          service: effectiveConfig.service as string | undefined,
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
        const provisioned = await this.provisioningDispatchService.provision(provider, provisioningConfig, credentials);

        if (provisioned?.serverId) {
          await this.subscriptionItemsRepository.updateProviderReference(baseItem.id, provisioned.serverId);
          await this.subscriptionItemsRepository.updateProvisioningStatus(baseItem.id, 'active');
          const serverInfo = await this.provisioningDispatchService.getServerInfo(
            provider,
            provisioned.serverId,
            credentials,
          );
          const publicIp = await this.provisioningDispatchService.ensurePublicIpForDns(
            provider,
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

    // Charge prepaid debt only after provisioning succeeds so a failed fulfill does not leave
    // an open position for a server the customer never received.
    if (plan.billInAdvance === true) {
      const createdSubscription = await this.subscriptionsRepository.findByIdOrThrow(subscription.id);

      await this.subscriptionPeriodChargeService.recordOpenPositionForPeriod(
        createdSubscription,
        plan,
        schedule.currentPeriodEnd,
        schedule.currentPeriodStart,
        schedule.currentPeriodEnd,
      );
    }

    return await this.backordersRepository.update(backorderId, { status: BackorderStatus.FULFILLED });
  }

  async mapToResponse(
    row: BackorderEntity,
    plan?: Awaited<ReturnType<ServicePlansRepository['findByIdOrThrow']>>,
    serviceType?: Awaited<ReturnType<ServiceTypesRepository['findByIdOrThrow']>>,
  ): Promise<BackorderResponseDto> {
    const resolvedPlan = plan ?? (await this.servicePlansRepository.findByIdOrThrow(row.planId));
    const resolvedServiceType =
      serviceType ?? (await this.serviceTypesRepository.findByIdOrThrow(resolvedPlan.serviceTypeId));
    const taxContext = await this.invoiceTaxContextService.resolveForUser(row.userId);
    const periodTotalPrice = await resolvePeriodTotalPrice(
      resolvedPlan,
      this.pricingService,
      this.taxCalculationService,
      this.providerServerTypesService,
      {
        configSnapshot: row.requestedConfigSnapshot,
        serviceType: resolvedServiceType,
        computeOptions: {
          taxTreatment: taxContext.treatment,
          forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
        },
      },
    );

    return {
      id: row.id,
      userId: row.userId,
      serviceTypeId: row.serviceTypeId,
      planId: row.planId,
      planName: resolvedPlan.name,
      status: row.status,
      failureReason: row.failureReason,
      requestedConfigSnapshot: row.requestedConfigSnapshot ?? {},
      providerErrors: row.providerErrors ?? {},
      preferredAlternatives: row.preferredAlternatives ?? {},
      retryAfter: row.retryAfter,
      periodTotalPrice,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async mapManyToResponses(rows: BackorderEntity[]): Promise<BackorderResponseDto[]> {
    if (rows.length === 0) {
      return [];
    }

    const planIds = [...new Set(rows.map((row) => row.planId))];
    const plansByPlanId = new Map<string, Awaited<ReturnType<ServicePlansRepository['findByIdOrThrow']>>>();
    const serviceTypesByPlanId = new Map<string, Awaited<ReturnType<ServiceTypesRepository['findByIdOrThrow']>>>();

    for (const planId of planIds) {
      const plan = await this.servicePlansRepository.findByIdOrThrow(planId);
      const serviceType = await this.serviceTypesRepository.findByIdOrThrow(plan.serviceTypeId);

      plansByPlanId.set(planId, plan);
      serviceTypesByPlanId.set(planId, serviceType);
    }

    return await Promise.all(
      rows.map((row) => this.mapToResponse(row, plansByPlanId.get(row.planId), serviceTypesByPlanId.get(row.planId))),
    );
  }
}
