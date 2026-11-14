import { Injectable, Logger } from '@nestjs/common';

import { CONFIG_CHANGE_ERROR_CODES } from '../constants/config-change-error.constants';
import { BillingEmailPublisher } from '../email/billing-email.publisher';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { SubscriptionConfigChangeEntity } from '../entities/subscription-config-change.entity';
import type { SubscriptionItemEntity } from '../entities/subscription-item.entity';
import { SubscriptionStatus, type SubscriptionEntity } from '../entities/subscription.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionConfigChangesRepository } from '../repositories/subscription-config-changes.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { getProvisioningCredentials, normalizeStoredProviderDefaults } from '../utils/provider-env-defaults.utils';
import { resolveItemProvider } from '../utils/provider-selection.utils';
import { BILLING_BASE_PRICE_CONFIG_KEY, resolveServerTypePriceMonthly } from '../utils/server-type-billing.utils';

import { AddonLifecycleService } from './addon-lifecycle.service';
import { ProviderServerTypesService } from './provider-server-types.service';
import { ProvisioningDispatchService } from './provisioning-dispatch.service';
import { SubscriptionConfigChangeBillingService } from './subscription-config-change-billing.service';

/** Step keys recorded in `applied_steps`; retries skip everything already listed there. */
const SERVER_TYPE_STEP = 'serverType';
const ADDON_ADD_STEP_PREFIX = 'addonAdd:';
const ADDON_REMOVE_STEP_PREFIX = 'addonRemove:';
const DEFAULT_PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 100;
/** Customer-facing failure text; the cause only ever reaches the log. */
const CONFIG_CHANGE_FAILED_MESSAGE = 'Configuration change failed';

/**
 * Applies accepted subscription configuration changes out of band.
 *
 * Every provider-visible step is recorded in `applied_steps` right after it succeeds, so a retry
 * resumes where the previous run stopped instead of resizing a server or provisioning an addon
 * twice. The first failing step aborts the run: partially applied infrastructure stays as it is
 * and is never billed, because one-shot billing only runs once all requested steps are recorded.
 *
 * `reclaimCount` is the claim generation: after a watchdog reclaim bumps it, the previous worker's
 * CAS writes (steps, billing slot, terminal transition) no longer match and become no-ops.
 */
@Injectable()
export class SubscriptionConfigChangeJobHandler {
  private readonly logger = new Logger(SubscriptionConfigChangeJobHandler.name);
  private readonly batchSize = this.parsePositiveInt('CONFIG_CHANGE_SCHEDULER_BATCH_SIZE', DEFAULT_BATCH_SIZE);
  private readonly processingTimeoutMs = this.parsePositiveInt(
    'CONFIG_CHANGE_PROCESSING_TIMEOUT_MS',
    DEFAULT_PROCESSING_TIMEOUT_MS,
  );

  constructor(
    private readonly configChangesRepository: SubscriptionConfigChangesRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly providerServerTypesService: ProviderServerTypesService,
    private readonly provisioningDispatchService: ProvisioningDispatchService,
    private readonly addonLifecycleService: AddonLifecycleService,
    private readonly configChangeBillingService: SubscriptionConfigChangeBillingService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly billingEmailPublisher: BillingEmailPublisher,
  ) {}

  async findPendingConfigChangeIds(): Promise<string[]> {
    return await this.configChangesRepository.findPendingIds(this.batchSize);
  }

  /**
   * Recovers rows abandoned by a worker that died mid-run. The first timeout returns the row to
   * `pending` for one more attempt; a second timeout fails it so a stuck change cannot loop forever.
   */
  async reclaimStuckProcessing(): Promise<void> {
    const before = new Date(Date.now() - this.processingTimeoutMs);
    const stuck = await this.configChangesRepository.findStuckProcessing(before, this.batchSize);

    for (const change of stuck) {
      if (change.reclaimCount > 0) {
        await this.failChange(change.id, change.subscriptionId, change.appliedSteps ?? [], change.reclaimCount);
        this.logger.error(`Config change ${change.id} exhausted its reclaim budget and was marked failed`);

        continue;
      }

      const reclaimed = await this.configChangesRepository.transitionFromProcessing(
        change.id,
        'pending',
        {
          reclaimCount: change.reclaimCount + 1,
          processingStartedAt: null,
        },
        change.reclaimCount,
      );

      if (reclaimed) {
        this.logger.warn(`Reclaimed stuck config change ${change.id} for another attempt`);
      }
    }
  }

  async processConfigChange(configChangeId: string): Promise<void> {
    const change = await this.configChangesRepository.claimForProcessing(configChangeId);

    if (!change) {
      this.logger.debug(`Config change ${configChangeId} was claimed by another worker`);

      return;
    }

    const claimGeneration = change.reclaimCount;
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(change.subscriptionId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
    const items = await this.subscriptionItemsRepository.findBySubscription(subscription.id);
    const item = items[0];

    if (!item) {
      this.logger.error(`Config change ${change.id} has no subscription item to apply changes to`);
      await this.failChange(change.id, subscription.id, change.appliedSteps ?? [], claimGeneration);

      return;
    }

    const appliedSteps = new Set(change.appliedSteps ?? []);

    try {
      await this.applyServerTypeStep({ change, claimGeneration, subscription, item, appliedSteps });
      await this.applyAddonRemovals({ change, claimGeneration, subscription, plan, item, appliedSteps });
      await this.applyAddonAdditions({ change, claimGeneration, subscription, plan, item, appliedSteps });
    } catch (error) {
      // Do not log raw provider/SSH messages: addon configs may include credentials that surface in errors.
      const errorName = error instanceof Error ? error.name : 'Error';

      this.logger.error(
        `Config change ${change.id} failed while applying steps (${errorName}); see applied_steps for progress`,
      );
      await this.failChange(change.id, subscription.id, [...appliedSteps], claimGeneration);

      return;
    }

    // Re-check ownership before one-shot billing so a reclaimed generation cannot settle here.
    const stillProcessing = await this.configChangesRepository.findById(change.id);

    if (!this.ownsProcessingClaim(stillProcessing, claimGeneration)) {
      this.logger.warn(`Lost the claim on config change ${change.id} before billing; skipping settlement`);

      return;
    }

    let billingOutcome = stillProcessing?.billingOutcome ?? null;

    if (billingOutcome == null) {
      const billingClaimed = await this.configChangesRepository.claimBillingSlot(change.id, claimGeneration);

      if (!billingClaimed) {
        const raced = await this.configChangesRepository.findById(change.id);

        if (!this.ownsProcessingClaim(raced, claimGeneration)) {
          this.logger.warn(`Lost the claim on config change ${change.id} while reserving billing`);

          return;
        }

        billingOutcome = raced?.billingOutcome ?? 'none';
      } else {
        billingOutcome = await this.settleBilling(change, subscription, plan, appliedSteps);
      }
    } else if (billingOutcome === 'deferred') {
      // Prior worker reserved billing then crashed; settle once more (apply is idempotent by change id).
      billingOutcome = await this.settleBilling(change, subscription, plan, appliedSteps);
    }

    const completed = await this.configChangesRepository.transitionFromProcessing(
      change.id,
      'completed',
      {
        billingOutcome,
        processedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
      claimGeneration,
    );

    if (!completed) {
      this.logger.warn(`Lost the claim on config change ${change.id} before completion; skipping notifications`);

      return;
    }

    await this.releaseSubscription(subscription.id);
    await this.notifyCompleted(subscription.id, change.id, [...appliedSteps], billingOutcome);
  }

  /**
   * Billing is deliberately skipped unless every requested step landed, so a partially applied
   * change never produces a charge the customer did not receive.
   */
  private async settleBilling(
    change: SubscriptionConfigChangeEntity,
    subscription: SubscriptionEntity,
    plan: ServicePlanEntity,
    appliedSteps: Set<string>,
  ): Promise<SubscriptionConfigChangeEntity['billingOutcome']> {
    if (!this.allRequestedStepsApplied(change, appliedSteps)) {
      this.logger.warn(`Config change ${change.id} is missing applied steps; skipping one-shot billing`);

      return 'deferred';
    }

    return await this.configChangeBillingService.apply({
      subscription,
      plan,
      change,
      changedAt: this.resolveChangedAt(change),
    });
  }

  private resolveChangedAt(change: SubscriptionConfigChangeEntity): Date {
    const effectiveAt = change.billingDisclaimerSnapshot?.effectiveAt;

    if (effectiveAt) {
      const parsed = new Date(effectiveAt);

      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    if (change.requestedAt) {
      return change.requestedAt;
    }

    return new Date();
  }

  private allRequestedStepsApplied(change: SubscriptionConfigChangeEntity, appliedSteps: Set<string>): boolean {
    return this.buildRequestedStepKeys(change).every((step) => appliedSteps.has(step));
  }

  private buildRequestedStepKeys(change: SubscriptionConfigChangeEntity): string[] {
    const payload = change.requestedPayload ?? {};
    const steps: string[] = [];

    if (payload.serverType) {
      steps.push(SERVER_TYPE_STEP);
    }

    for (const addonId of payload.removeAddonIds ?? []) {
      steps.push(`${ADDON_REMOVE_STEP_PREFIX}${addonId}`);
    }

    for (const addonId of payload.addAddonIds ?? []) {
      steps.push(`${ADDON_ADD_STEP_PREFIX}${addonId}`);
    }

    return steps;
  }

  private async applyServerTypeStep(params: {
    change: SubscriptionConfigChangeEntity;
    claimGeneration: number;
    subscription: SubscriptionEntity;
    item: SubscriptionItemEntity;
    appliedSteps: Set<string>;
  }): Promise<void> {
    const { change, claimGeneration, item, appliedSteps } = params;
    const targetServerType = change.requestedPayload?.serverType?.trim();

    if (!targetServerType || appliedSteps.has(SERVER_TYPE_STEP)) {
      return;
    }

    const provider = resolveItemProvider(item)?.trim();

    if (!provider || !item.providerReference) {
      throw new Error(`Subscription item ${item.id} has no provisioned server to resize`);
    }

    const providerDefaults = normalizeStoredProviderDefaults(item.serviceType?.providerDefaults);
    const currentServerType = this.readServerType(item);
    const currentPrice = currentServerType
      ? await resolveServerTypePriceMonthly(
          this.providerServerTypesService,
          provider,
          currentServerType,
          providerDefaults,
        )
      : null;
    const newPrice = await resolveServerTypePriceMonthly(
      this.providerServerTypesService,
      provider,
      targetServerType,
      providerDefaults,
    );

    if (newPrice == null) {
      throw new Error(`Server type "${targetServerType}" has no price on provider "${provider}"`);
    }

    if (currentServerType === targetServerType) {
      await this.recordStep(change.id, SERVER_TYPE_STEP, appliedSteps, claimGeneration);

      return;
    }

    await this.assertOwnsProcessingClaim(change.id, claimGeneration);

    await this.provisioningDispatchService.changeServerType(provider, item.providerReference, targetServerType, {
      isUpgrade: currentPrice == null || newPrice > currentPrice,
      credentials: getProvisioningCredentials(provider, item.serviceType?.providerDefaults),
      sshPrivateKey: item.sshPrivateKey,
    });

    await this.subscriptionItemsRepository.updateConfigSnapshot(item.id, {
      ...(item.configSnapshot ?? {}),
      serverType: targetServerType,
      [BILLING_BASE_PRICE_CONFIG_KEY]: newPrice,
    });

    await this.recordStep(change.id, SERVER_TYPE_STEP, appliedSteps, claimGeneration);
  }

  private async applyAddonRemovals(params: {
    change: SubscriptionConfigChangeEntity;
    claimGeneration: number;
    subscription: SubscriptionEntity;
    plan: ServicePlanEntity;
    item: SubscriptionItemEntity;
    appliedSteps: Set<string>;
  }): Promise<void> {
    const { change, claimGeneration, subscription, plan, item, appliedSteps } = params;
    const provider = resolveItemProvider(item)?.trim() ?? '';

    for (const addonId of change.requestedPayload?.removeAddonIds ?? []) {
      const step = `${ADDON_REMOVE_STEP_PREFIX}${addonId}`;

      if (appliedSteps.has(step)) {
        continue;
      }

      await this.assertOwnsProcessingClaim(change.id, claimGeneration);

      await this.addonLifecycleService.deprovisionMidLife({
        subscription,
        plan,
        item,
        provider,
        addonIds: [addonId],
      });

      await this.recordStep(change.id, step, appliedSteps, claimGeneration);
    }
  }

  private async applyAddonAdditions(params: {
    change: SubscriptionConfigChangeEntity;
    claimGeneration: number;
    subscription: SubscriptionEntity;
    plan: ServicePlanEntity;
    item: SubscriptionItemEntity;
    appliedSteps: Set<string>;
  }): Promise<void> {
    const { change, claimGeneration, subscription, plan, item, appliedSteps } = params;
    const provider = resolveItemProvider(item)?.trim() ?? '';
    const addonConfigs = change.requestedPayload?.addonConfigs;

    for (const addonId of change.requestedPayload?.addAddonIds ?? []) {
      const step = `${ADDON_ADD_STEP_PREFIX}${addonId}`;

      if (appliedSteps.has(step)) {
        continue;
      }

      await this.assertOwnsProcessingClaim(change.id, claimGeneration);

      await this.addonLifecycleService.provisionMidLife({
        subscription,
        plan,
        item,
        provider,
        addonIds: [addonId],
        ...(addonConfigs ? { addonConfigs } : {}),
      });

      await this.recordStep(change.id, step, appliedSteps, claimGeneration);
    }
  }

  private async recordStep(
    changeId: string,
    step: string,
    appliedSteps: Set<string>,
    claimGeneration: number,
  ): Promise<void> {
    const appended = await this.configChangesRepository.appendAppliedStep(changeId, step, claimGeneration);

    if (appended) {
      appliedSteps.add(step);

      return;
    }

    // Append can return false when the step is already persisted (idempotent) or the claim was lost.
    const current = await this.configChangesRepository.findById(changeId);

    if (this.ownsProcessingClaim(current, claimGeneration) && (current?.appliedSteps ?? []).includes(step)) {
      appliedSteps.add(step);

      return;
    }

    throw new Error(`Lost processing claim while recording step "${step}" for config change ${changeId}`);
  }

  private async assertOwnsProcessingClaim(changeId: string, claimGeneration: number): Promise<void> {
    const current = await this.configChangesRepository.findById(changeId);

    if (!this.ownsProcessingClaim(current, claimGeneration)) {
      throw new Error(`Lost processing claim for config change ${changeId}`);
    }
  }

  private ownsProcessingClaim(
    change: SubscriptionConfigChangeEntity | null | undefined,
    claimGeneration: number,
  ): boolean {
    return !!change && change.status === 'processing' && change.reclaimCount === claimGeneration;
  }

  private readServerType(item: SubscriptionItemEntity): string | undefined {
    const value = item.configSnapshot?.['serverType'];

    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private async failChange(
    changeId: string,
    subscriptionId: string,
    appliedSteps: string[],
    claimGeneration: number,
  ): Promise<void> {
    const failed = await this.configChangesRepository.transitionFromProcessing(
      changeId,
      'failed',
      {
        errorCode: CONFIG_CHANGE_ERROR_CODES.FAILED,
        errorMessage: CONFIG_CHANGE_FAILED_MESSAGE,
        processedAt: new Date(),
      },
      claimGeneration,
    );

    if (!failed) {
      return;
    }

    await this.releaseSubscription(subscriptionId);
    await this.notifyFailed(subscriptionId, changeId, appliedSteps);
  }

  private async releaseSubscription(subscriptionId: string): Promise<void> {
    try {
      await this.subscriptionsRepository.compareAndSetStatus(
        subscriptionId,
        SubscriptionStatus.PENDING_CONFIG_CHANGE,
        SubscriptionStatus.ACTIVE,
      );
    } catch (error) {
      this.logger.error(
        `Failed to return subscription ${subscriptionId} to active after a config change: ${(error as Error).name}`,
      );
    }
  }

  private async notifyCompleted(
    subscriptionId: string,
    configChangeId: string,
    appliedSteps: string[],
    billingOutcome: SubscriptionConfigChangeEntity['billingOutcome'],
  ): Promise<void> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);

    this.billingNotificationPublisher.publishConfigChanged(subscription, plan, {
      configChangeId,
      appliedSteps,
      billingOutcome: billingOutcome ?? null,
    });
    await this.billingEmailPublisher.publishConfigChangeApplied(subscription, plan.name);
    this.logger.log(`Applied config change ${configChangeId} for subscription ${subscriptionId}`);
  }

  private async notifyFailed(subscriptionId: string, configChangeId: string, appliedSteps: string[]): Promise<void> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);

    this.billingNotificationPublisher.publishConfigChangeFailed(subscription, plan, {
      configChangeId,
      appliedSteps,
      errorCode: CONFIG_CHANGE_ERROR_CODES.FAILED,
    });
    await this.billingEmailPublisher.publishConfigChangeFailed(subscription, plan.name);
  }

  private parsePositiveInt(envKey: string, fallback: number): number {
    const parsed = parseInt(process.env[envKey] ?? String(fallback), 10);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
