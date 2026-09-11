import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { SubscriptionResponseDto } from '../dto/subscription-response.dto';
import type { WithdrawalEligibilityDto, WithdrawalResultDto } from '../dto/withdrawal-policy.dto';
import { BillingIntervalType, type ServicePlanEntity } from '../entities/service-plan.entity';
import { ProvisioningStatus } from '../entities/subscription-item.entity';
import { SubscriptionEntity, SubscriptionStatus } from '../entities/subscription.entity';
import { PromotionRedemptionContext } from '../constants/promotion.constants';
import { BackordersRepository } from '../repositories/backorders.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionNumberSequencesRepository } from '../repositories/subscription-number-sequences.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { CloudInitDispatchService } from './cloud-init-dispatch.service';
import { normalizeCloudInitService } from '../utils/cloud-init/cloud-init-dispatch.utils';
import { mirrorGeographyInConfig, resolveProvisioningRegion } from '../utils/provider-location.utils';
import { resolveItemProvider } from '../utils/provider-selection.utils';
import { buildBackorderRequestedConfigSnapshot, resolvePeriodTotalPrice } from '../utils/server-type-billing.utils';
import { getProvisioningCredentials } from '../utils/provider-env-defaults.utils';
import { generateSshKeyPair } from '../utils/ssh-key.utils';
import { mapSubscriptionItemToResponse } from '../utils/subscription-item-response.utils';

import { AddonService } from './addon.service';
import { AddonLifecycleService } from './addon-lifecycle.service';
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
import { ProviderServerTypesService } from './provider-server-types.service';
import { PricingService } from './pricing.service';
import { ProviderCatalogDispatchService } from './provider-catalog-dispatch.service';
import { ProviderRegistryService } from './provider-registry.service';
import { ProvisioningDispatchService } from './provisioning-dispatch.service';
import { PromotionRedemptionService } from './promotion-redemption.service';
import { SshExecutorService } from './ssh-executor.service';
import { TaxCalculationService } from './tax-calculation.service';
import { InvoiceTaxContextService } from './invoice-tax-context.service';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { mapSubscriptionToSearchDocument } from '../search/billing-search-document.mapper';
import { BillingSearchIndexService } from '../search/billing-search-index.service';
import { getRequiredTenantId } from '../utils/tenant-query.utils';
import { BillingEmailPublisher } from '../email/billing-email.publisher';
import { CustomerTrustScoreService } from '../trust-score/customer-trust-score.service';
import { SubscriptionPeriodChargeService } from './subscription-period-charge.service';
import { convertAddonPriceToPlanPeriod } from '../utils/addon-pricing.util';
import { MeterBillingService } from './meter-billing.service';
import {
  SubscriptionOrderPreparationService,
  type PreparedPlanOrderContext,
} from '../offers/services/subscription-order-preparation.service';

const PROVISIONING_SSH_USER = 'root';
const PROVISIONING_SSH_PORT = 22;
/** Lightweight auth probe; success means cloud-init at least installed our key and sshd accepts it. */
const PROVISIONING_SSH_PROBE_COMMAND = 'true';
const PROVISIONING_SSH_PROBE_TIMEOUT_MS = 15_000;
const PROVISIONING_SSH_RETRY_INTERVAL_MS = 30_000;
const PROVISIONING_SSH_RETRY_WINDOW_MS = 5 * 60_000;

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly serviceTypesRepository: ServiceTypesRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly subscriptionNumberSequencesRepository: SubscriptionNumberSequencesRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly billingScheduleService: BillingScheduleService,
    private readonly cancellationPolicyService: CancellationPolicyService,
    private readonly backorderService: BackorderService,
    private readonly availabilityService: AvailabilityService,
    private readonly provisioningDispatchService: ProvisioningDispatchService,
    private readonly providerCatalogDispatchService: ProviderCatalogDispatchService,
    private readonly hostnameReservationService: HostnameReservationService,
    private readonly cloudflareDnsService: CloudflareDnsService,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly cloudInitConfigService: CloudInitConfigService,
    private readonly addonService: AddonService,
    private readonly addonLifecycleService: AddonLifecycleService,
    private readonly providerServerTypesService: ProviderServerTypesService,
    private readonly pricingService: PricingService,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly withdrawalPolicyService: WithdrawalPolicyService,
    private readonly withdrawalRefundService: WithdrawalRefundService,
    private readonly backordersRepository: BackordersRepository,
    private readonly promotionRedemptionService: PromotionRedemptionService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly billingEmailPublisher: BillingEmailPublisher,
    private readonly customerTrustScoreService: CustomerTrustScoreService,
    private readonly subscriptionPeriodChargeService: SubscriptionPeriodChargeService,
    private readonly sshExecutor: SshExecutorService,
    private readonly meterBillingService: MeterBillingService,
    private readonly billingSearchIndexService: BillingSearchIndexService,
    private readonly cloudInitDispatchService: CloudInitDispatchService,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly subscriptionOrderPreparationService: SubscriptionOrderPreparationService,
  ) {}

  async createSubscription(
    userId: string,
    planId: string,
    requestedConfig?: Record<string, unknown>,
    autoBackorder = false,
    promotionCode?: string,
    promotionBenefitStartsAt?: string,
    addonIds?: string[],
    addonConfigs?: Record<string, Record<string, string>>,
  ) {
    const prepared = await this.subscriptionOrderPreparationService.prepareForUser(
      userId,
      {
        planId,
        requestedConfig,
        addonIds,
        addonConfigs,
        autoBackorder,
        promotionCode,
        promotionBenefitStartsAt,
      },
      { throwOnUnavailable: !autoBackorder },
    );

    return this.createSubscriptionFromPrepared(userId, prepared, {
      autoBackorder,
      promotionCode,
      promotionBenefitStartsAt,
    });
  }

  async createSubscriptionFromPrepared(
    userId: string,
    prepared: PreparedPlanOrderContext,
    options?: {
      autoBackorder?: boolean;
      promotionCode?: string;
      promotionBenefitStartsAt?: string;
    },
  ): Promise<SubscriptionEntity> {
    const autoBackorder = options?.autoBackorder ?? false;
    const promotionCode = options?.promotionCode;
    const promotionBenefitStartsAt = options?.promotionBenefitStartsAt;

    if (prepared.billingOnly) {
      return this.createSubscriptionWithoutServiceType(userId, prepared, promotionCode, promotionBenefitStartsAt);
    }

    if (prepared.availability && !prepared.availability.isAvailable) {
      if (autoBackorder) {
        await this.backorderService.create({
          userId,
          serviceTypeId: prepared.plan.serviceTypeId!,
          planId: prepared.plan.id,
          requestedConfigSnapshot: buildBackorderRequestedConfigSnapshot(
            prepared.sanitizedRequested,
            prepared.effectiveConfig,
          ),
          providerErrors: { reason: prepared.availability.reason },
          preferredAlternatives: prepared.availability.alternatives ?? {},
        });
      }

      throw new BadRequestException(prepared.availability.reason || 'Configuration not available');
    }

    const plan = prepared.plan;
    const selectedAddons = prepared.selectedAddons;
    const filteredAddonConfigs = prepared.addonConfigs;
    const effectiveConfig = prepared.effectiveConfig;

    const schedule = this.billingScheduleService.calculateSchedule(
      plan.billingIntervalType as BillingIntervalType,
      plan.billingIntervalValue,
      plan.billingDayOfMonth,
    );
    const allocatedNumber = await this.subscriptionNumberSequencesRepository.nextSubscriptionNumber();
    const subscription = await this.subscriptionsRepository.create({
      userId,
      planId: plan.id,
      number: allocatedNumber.number,
      numberScope: allocatedNumber.numberScope,
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

    await this.addonLifecycleService.createPendingSubscriptionAddons({
      subscriptionId: subscription.id,
      addons: selectedAddons,
      plan,
      addonConfigs: filteredAddonConfigs,
    });

    if (promotionCode?.trim()) {
      try {
        await this.promotionRedemptionService.redeem(
          userId,
          promotionCode.trim(),
          subscription.id,
          PromotionRedemptionContext.NEW,
          { benefitStartsAt: promotionBenefitStartsAt },
        );
      } catch (error) {
        await this.subscriptionsRepository.delete(subscription.id);
        throw error;
      }
    }

    // Reload so relations and any DB-side defaults are fully populated on the returned entity.
    const created = await this.subscriptionsRepository.findByIdOrThrow(subscription.id);

    if (plan.billInAdvance === true) {
      await this.subscriptionPeriodChargeService.recordOpenPositionForPeriod(
        created,
        plan,
        schedule.currentPeriodEnd,
        schedule.currentPeriodStart,
        schedule.currentPeriodEnd,
      );
    }

    const addonSummaries = selectedAddons.map((addon) => ({
      id: addon.id,
      key: addon.key,
      name: addon.name,
      periodPrice: convertAddonPriceToPlanPeriod(addon, plan),
    }));

    this.billingNotificationPublisher.publishSubscription('subscription.created', created, plan, {
      addons: addonSummaries,
    });
    this.indexSubscription(created, plan.name);
    await this.billingEmailPublisher.publishSubscriptionCreated(created, plan.name, {
      billInAdvance: plan.billInAdvance === true,
      addons: addonSummaries.map((addon) => ({ name: addon.name, periodPrice: addon.periodPrice })),
    });
    this.customerTrustScoreService.triggerRecomputeForUser(created.userId);

    return created;
  }

  /**
   * Billing-only plans with no service type: no cloud config, availability, or provisioning.
   * Creates the subscription and an immediately active item with null serviceTypeId.
   */
  private async createSubscriptionWithoutServiceType(
    userId: string,
    prepared: PreparedPlanOrderContext,
    promotionCode?: string,
    promotionBenefitStartsAt?: string,
  ) {
    const plan = prepared.plan;

    const schedule = this.billingScheduleService.calculateSchedule(
      plan.billingIntervalType as BillingIntervalType,
      plan.billingIntervalValue,
      plan.billingDayOfMonth,
    );
    const allocatedNumber = await this.subscriptionNumberSequencesRepository.nextSubscriptionNumber();
    const subscription = await this.subscriptionsRepository.create({
      userId,
      planId: plan.id,
      number: allocatedNumber.number,
      numberScope: allocatedNumber.numberScope,
      status: SubscriptionStatus.ACTIVE,
      autoBackorder: false,
      currentPeriodStart: schedule.currentPeriodStart,
      currentPeriodEnd: schedule.currentPeriodEnd,
      nextBillingAt: schedule.nextBillingAt,
    });

    const item = await this.subscriptionItemsRepository.create({
      subscriptionId: subscription.id,
      serviceTypeId: null,
      configSnapshot: {},
    });

    await this.subscriptionItemsRepository.updateProvisioningStatus(item.id, 'active');

    if (promotionCode?.trim()) {
      try {
        await this.promotionRedemptionService.redeem(
          userId,
          promotionCode.trim(),
          subscription.id,
          PromotionRedemptionContext.NEW,
          { benefitStartsAt: promotionBenefitStartsAt },
        );
      } catch (error) {
        await this.subscriptionsRepository.delete(subscription.id);
        throw error;
      }
    }

    const created = await this.subscriptionsRepository.findByIdOrThrow(subscription.id);

    if (plan.billInAdvance === true) {
      await this.subscriptionPeriodChargeService.recordOpenPositionForPeriod(
        created,
        plan,
        schedule.currentPeriodEnd,
        schedule.currentPeriodStart,
        schedule.currentPeriodEnd,
      );
    }

    this.billingNotificationPublisher.publishSubscription('subscription.created', created, plan, {
      addons: [],
    });
    this.indexSubscription(created, plan.name);
    await this.billingEmailPublisher.publishSubscriptionCreated(created, plan.name, {
      billInAdvance: plan.billInAdvance === true,
      addons: [],
    });
    this.customerTrustScoreService.triggerRecomputeForUser(created.userId);

    return created;
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
    const provider = resolveItemProvider(item);

    if (!subscription || subscription.status !== SubscriptionStatus.ACTIVE) {
      this.logger.log(`Skipping provisioning for item ${itemId}; subscription is not active`);

      return;
    }

    if (!provider || !this.providerCatalogDispatchService.requiresProvisioning(provider)) {
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
    const credentials = getProvisioningCredentials(provider, item.serviceType?.providerDefaults);

    try {
      hostname = await this.hostnameReservationService.reserveHostname(itemId);
      const { publicKey, privateKey } = generateSshKeyPair();

      await this.subscriptionItemsRepository.updateSshPrivateKey(itemId, privateKey);
      effectiveConfig.sshPublicKey = publicKey;
      const baseDomain = process.env.DNS_BASE_DOMAIN ?? 'spirde.com';
      let userData = this.cloudInitDispatchService.buildUserData({
        service: effectiveConfig.service as string | undefined,
        effectiveConfig,
        hostname,
        baseDomain,
        customTemplate,
        resolvedCustomEnv,
      });

      const subscriptionAddons = await this.addonLifecycleService.listForSubscription(subscription.id);
      const scripts = this.addonLifecycleService.collectInterpolatedCloudInitScripts(subscriptionAddons);

      userData = this.addonLifecycleService.appendScriptsToUserData(userData, scripts);

      const provisioned = await this.provisioningDispatchService.provision(
        provider,
        {
          name: hostname,
          serverType,
          location: region,
          firewallId: effectiveConfig.firewallId as number | undefined,
          userData,
        },
        credentials,
      );

      provisionedServerId = provisioned?.serverId;

      if (provisioned?.serverId) {
        await this.subscriptionItemsRepository.updateProviderReference(itemId, provisioned.serverId);
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

        if (publicIp?.trim()) {
          try {
            await this.waitForProvisionedSshAccess(publicIp.trim(), privateKey);
          } catch (sshError) {
            this.logger.warn(
              `SSH readiness check failed for ${hostname} (${publicIp}); continuing provisioning: ${(sshError as Error).message}`,
            );
          }
        } else {
          this.logger.warn(
            `Provisioned server ${provisioned.serverId} has no public IP yet; skipping SSH readiness check`,
          );
        }

        await this.subscriptionItemsRepository.updateProvisioningStatus(itemId, 'active');

        if (publicIp) {
          try {
            await this.cloudflareDnsService.createARecord(hostname, publicIp);
          } catch (dnsError) {
            this.logger.warn(
              `DNS record creation failed for ${hostname}, server provisioned with IP ${publicIp}: ${(dnsError as Error).message}`,
            );
          }
        }

        const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
        const refreshedItem = await this.subscriptionItemsRepository.findByIdWithRelations(itemId);

        this.billingNotificationPublisher.publishSubscriptionProvisioned({
          subscription,
          plan,
          itemId,
          hostname,
          service: typeof effectiveConfig.service === 'string' ? effectiveConfig.service : null,
          providerReference: provisioned.serverId,
        });

        if (refreshedItem) {
          await this.addonLifecycleService.activateAfterProvisioning({
            subscription,
            plan,
            item: refreshedItem,
            provider,
          });
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
        this.billingNotificationPublisher.publishSubscriptionProvisionFailed({
          subscription,
          itemId,
          errorMessage: (error as Error).message,
          providerReference: provisionedServerId,
        });

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

      this.billingNotificationPublisher.publishSubscriptionProvisionFailed({
        subscription,
        itemId,
        errorMessage: (error as Error).message,
      });

      this.logger.error(`Provisioning item ${itemId} failed: ${(error as Error).message}`);
    }
  }

  /**
   * Confirms the generated key can authenticate as root. Port-open alone is not enough:
   * sshd may accept TCP before cloud-init writes authorized_keys.
   * Retries every 30s for up to 5 minutes.
   */
  private async waitForProvisionedSshAccess(publicIp: string, privateKey: string): Promise<void> {
    const deadline = Date.now() + PROVISIONING_SSH_RETRY_WINDOW_MS;
    let attempt = 0;
    let lastError: Error | undefined;

    this.logger.log(
      `Waiting for SSH login on ${publicIp}:${PROVISIONING_SSH_PORT} after provisioning ` +
        `(retry every ${PROVISIONING_SSH_RETRY_INTERVAL_MS / 1000}s for ${PROVISIONING_SSH_RETRY_WINDOW_MS / 1000}s)`,
    );

    while (Date.now() <= deadline) {
      attempt += 1;

      try {
        const remainingMs = Math.max(1_000, deadline - Date.now());
        await this.sshExecutor.waitUntilReachable(publicIp, PROVISIONING_SSH_PORT, {
          timeoutMs: Math.min(PROVISIONING_SSH_RETRY_INTERVAL_MS - 1_000, remainingMs),
        });

        const result = await this.sshExecutor.exec(
          publicIp,
          PROVISIONING_SSH_PORT,
          PROVISIONING_SSH_USER,
          privateKey,
          PROVISIONING_SSH_PROBE_COMMAND,
          { commandTimeoutMs: PROVISIONING_SSH_PROBE_TIMEOUT_MS },
        );

        if (result.code !== 0) {
          throw new Error(
            `SSH login probe on ${publicIp} exited with code ${result.code}` +
              (result.stderr?.trim() ? `: ${result.stderr.trim()}` : ''),
          );
        }

        this.logger.log(`SSH login succeeded on ${publicIp}:${PROVISIONING_SSH_PORT} (attempt ${attempt})`);

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `SSH login attempt ${attempt} on ${publicIp}:${PROVISIONING_SSH_PORT} failed: ${lastError.message}`,
        );
      }

      const remainingMs = deadline - Date.now();

      if (remainingMs <= 0) {
        break;
      }

      await this.delay(Math.min(PROVISIONING_SSH_RETRY_INTERVAL_MS, remainingMs));
    }

    throw (
      lastError ??
      new Error(
        `SSH login did not succeed on ${publicIp}:${PROVISIONING_SSH_PORT} within ${PROVISIONING_SSH_RETRY_WINDOW_MS}ms`,
      )
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async listSubscriptions(userId: string, limit: number, offset: number, search?: string) {
    return await this.subscriptionsRepository.findAllByUser(userId, limit, offset, search);
  }

  async getSubscriptionsSummary(userId: string): Promise<{
    total: number;
    active: number;
    pendingBackorders: number;
  }> {
    const [total, active, pendingBackorders] = await Promise.all([
      this.subscriptionsRepository.countByUserId(userId),
      this.subscriptionsRepository.countByUserIdAndStatus(userId, SubscriptionStatus.ACTIVE),
      this.backordersRepository.countOpenByUserId(userId),
    ]);

    return { total, active, pendingBackorders };
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
      new Date(),
      { billInAdvance: plan.billInAdvance === true },
    );

    if (!decision.canCancel) {
      throw new BadRequestException(decision.reason || 'Cancellation not permitted');
    }

    const canceled = await this.subscriptionsRepository.update(subscriptionId, {
      status: SubscriptionStatus.PENDING_CANCEL,
      cancelRequestedAt: new Date(),
      cancelEffectiveAt: decision.effectiveAt,
    });

    this.billingNotificationPublisher.publishSubscription('subscription.cancel_scheduled', canceled, plan);
    this.indexSubscription(canceled, plan.name);
    this.customerTrustScoreService.triggerRecomputeForUser(canceled.userId);
    await this.billingEmailPublisher.publishSubscriptionCancelScheduled(canceled, plan.name);

    return canceled;
  }

  async resumeSubscription(subscriptionId: string, userId: string): Promise<SubscriptionEntity> {
    const subscription = await this.getSubscription(subscriptionId, userId);

    if (subscription.status !== SubscriptionStatus.PENDING_CANCEL) {
      throw new BadRequestException('Subscription is not pending cancel');
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const resumed = await this.subscriptionsRepository.update(subscriptionId, {
      status: SubscriptionStatus.ACTIVE,
      resumedAt: new Date(),
      cancelRequestedAt: null,
      cancelEffectiveAt: null,
    });

    this.billingNotificationPublisher.publishSubscription('subscription.resumed', resumed, plan);
    this.indexSubscription(resumed, plan.name);
    this.customerTrustScoreService.triggerRecomputeForUser(resumed.userId);
    await this.billingEmailPublisher.publishSubscriptionResumed(resumed, plan.name);

    return resumed;
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
    const serviceType = plan.serviceTypeId
      ? await this.serviceTypesRepository.findByIdOrThrow(plan.serviceTypeId)
      : { disallowStatutoryWithdrawal: false };
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

    this.billingNotificationPublisher.publishSubscription('subscription.updated', updated, plan);
    this.indexSubscription(updated, plan.name);
    this.customerTrustScoreService.triggerRecomputeForUser(updated.userId);

    const withdrawalResult: WithdrawalResultDto = {
      refundGross: estimatedRefundGross,
      paymentRefundStatus: estimatedRefundGross ? 'pending' : 'not_applicable',
    };

    return { subscription: updated, withdrawalResult };
  }

  async instantCancelSubscription(
    subscriptionId: string,
    userId: string,
  ): Promise<{ subscription: SubscriptionEntity }> {
    await this.getSubscription(subscriptionId, userId);

    return this.executeInstantCancel(subscriptionId);
  }

  async executeInstantCancel(subscriptionId: string): Promise<{ subscription: SubscriptionEntity }> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const allowedStatuses: SubscriptionStatus[] = [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.PENDING_CANCEL,
      SubscriptionStatus.PENDING_BACKORDER,
    ];

    if (!allowedStatuses.includes(subscription.status)) {
      throw new BadRequestException('Instant cancel is not permitted for this subscription');
    }

    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);

    await this.backordersRepository.cancelPendingForUserPlan(subscription.userId, subscription.planId);

    const instantCanceledAt = new Date();

    await this.subscriptionsRepository.update(subscriptionId, {
      status: SubscriptionStatus.PENDING_INSTANT_CANCEL,
      instantRemoval: true,
      instantCanceledAt,
      cancelEffectiveAt: null,
    });

    const updated = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    this.billingNotificationPublisher.publishSubscription('subscription.updated', updated, plan);
    this.indexSubscription(updated, plan.name);
    this.customerTrustScoreService.triggerRecomputeForUser(updated.userId);

    return { subscription: updated };
  }

  async mapToResponse(
    subscription: SubscriptionEntity,
    items = [] as Awaited<ReturnType<SubscriptionItemsRepository['findBySubscription']>>,
    serviceType?: { disallowStatutoryWithdrawal: boolean },
    withdrawalResult?: WithdrawalResultDto,
    plan?: ServicePlanEntity,
  ): Promise<SubscriptionResponseDto> {
    let eligibility: WithdrawalEligibilityDto | undefined;
    let periodTotalPrice: number | undefined;

    if (plan) {
      const taxContext = await this.invoiceTaxContextService.resolveForUser(subscription.userId);
      periodTotalPrice = await resolvePeriodTotalPrice(
        plan,
        this.pricingService,
        this.taxCalculationService,
        this.providerServerTypesService,
        {
          items,
          computeOptions: {
            taxTreatment: taxContext.treatment,
            forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
          },
        },
      );
    }

    if (serviceType) {
      const decision = this.withdrawalPolicyService.evaluate({
        subscriptionStatus: subscription.status,
        items,
        serviceType,
        statutoryWithdrawalRestartedAt: subscription.statutoryWithdrawalRestartedAt,
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
      planName: plan?.name,
      userId: subscription.userId,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      nextBillingAt: subscription.nextBillingAt,
      cancelRequestedAt: subscription.cancelRequestedAt,
      cancelEffectiveAt: subscription.cancelEffectiveAt,
      resumedAt: subscription.resumedAt,
      withdrawnAt: subscription.withdrawnAt,
      instantRemoval: subscription.instantRemoval,
      instantCanceledAt: subscription.instantCanceledAt,
      withdrawalEligibility: eligibility,
      withdrawalResult,
      periodTotalPrice,
      meters: await this.meterBillingService.buildSubscriptionMeterSummaries({
        subscription,
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
      }),
      items: items.map((item) => mapSubscriptionItemToResponse(item)),
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
    const plansByPlanId = new Map<string, ServicePlanEntity>();
    const serviceTypesByPlan = new Map<
      string,
      { disallowStatutoryWithdrawal: boolean } | Awaited<ReturnType<ServiceTypesRepository['findByIdOrThrow']>>
    >();

    for (const planId of planIds) {
      const plan = await this.servicePlansRepository.findByIdOrThrow(planId);
      const serviceType = plan.serviceTypeId
        ? await this.serviceTypesRepository.findByIdOrThrow(plan.serviceTypeId)
        : { disallowStatutoryWithdrawal: false };

      plansByPlanId.set(planId, plan);
      serviceTypesByPlan.set(planId, serviceType);
    }

    return await Promise.all(
      subscriptions.map((subscription) =>
        this.mapToResponse(
          subscription,
          itemsBySubscription.get(subscription.id) ?? [],
          serviceTypesByPlan.get(subscription.planId),
          undefined,
          plansByPlanId.get(subscription.planId),
        ),
      ),
    );
  }

  private indexSubscription(subscription: SubscriptionEntity, planName?: string): void {
    this.billingSearchIndexService.scheduleUpsert(
      'subscriptions',
      mapSubscriptionToSearchDocument(subscription, getRequiredTenantId(), { planName }),
    );
  }
}
