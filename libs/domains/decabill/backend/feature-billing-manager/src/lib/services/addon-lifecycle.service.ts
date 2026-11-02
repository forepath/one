import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { LOADWEAVER_ADMIN_CLAIM_TOKEN_KEY } from '../contributors/loadweaver/loadweaver.utils';
import { AddonEntity } from '../entities/addon.entity';
import { SubscriptionAddonEntity } from '../entities/subscription-addon.entity';
import { SubscriptionItemEntity } from '../entities/subscription-item.entity';
import { ServicePlanEntity } from '../entities/service-plan.entity';
import { SubscriptionEntity } from '../entities/subscription.entity';
import { BillingEmailPublisher } from '../email/billing-email.publisher';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { AddonsRepository } from '../repositories/addons.repository';
import { SubscriptionAddonsRepository } from '../repositories/subscription-addons.repository';
import {
  interpolateAddonScriptTemplate,
  parseAddonConfigFields,
  resolveAddonConfigValues,
} from '../utils/addon-config.utils';
import { convertAddonPriceToPlanPeriod } from '../utils/addon-pricing.util';
import { getProvisioningCredentials } from '../utils/provider-env-defaults.utils';

import { AddonModuleRegistryService, type AddonLifecycleContext } from './addon-module-registry.service';
import { ProvisioningDispatchService } from './provisioning-dispatch.service';
import { SshExecutorService } from './ssh-executor.service';
import { resolvePlainTextUserData } from '../utils/cloud-init/user-data.utils';

const SSH_USER = 'root';
const SSH_PORT = 22;
const DEFAULT_SSH_COMMAND_TIMEOUT_MS = 120000;

/** Customer-facing messages stay generic; details (never scripts or config) go to the log only. */
const PROVISION_FAILED_MESSAGE = 'Addon provision failed';
const TEARDOWN_FAILED_MESSAGE = 'Addon teardown failed';

export interface AddonMidLifeProvisionParams {
  subscription: SubscriptionEntity;
  plan: ServicePlanEntity;
  item: SubscriptionItemEntity;
  provider: string;
  addonIds: string[];
  addonConfigs?: Record<string, Record<string, string>>;
  /** Skips the provider lookup when the caller already resolved the server address. */
  publicIp?: string;
}

export interface AddonMidLifeDeprovisionParams {
  subscription: SubscriptionEntity;
  plan: ServicePlanEntity;
  item: SubscriptionItemEntity;
  provider: string;
  subscriptionAddonIds?: string[];
  addonIds?: string[];
  publicIp?: string;
}

/**
 * Snapshot keys that are secrets of the platform, not addon configuration: never interpolated into addon scripts
 * (L7), even if a snapshot or an addon schema carries them.
 */
export const ADDON_SCRIPT_EXCLUDED_SNAPSHOT_KEYS: readonly string[] = [LOADWEAVER_ADMIN_CLAIM_TOKEN_KEY];

@Injectable()
export class AddonLifecycleService {
  private readonly logger = new Logger(AddonLifecycleService.name);

  constructor(
    private readonly subscriptionAddonsRepository: SubscriptionAddonsRepository,
    private readonly addonModuleRegistry: AddonModuleRegistryService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly billingEmailPublisher: BillingEmailPublisher,
    private readonly addonsRepository: AddonsRepository,
    private readonly provisioningDispatchService: ProvisioningDispatchService,
    private readonly sshExecutor: SshExecutorService,
  ) {}

  async createPendingSubscriptionAddons(params: {
    subscriptionId: string;
    addons: AddonEntity[];
    plan: Pick<ServicePlanEntity, 'billingIntervalType' | 'billingIntervalValue'>;
    addonConfigs?: Record<string, Record<string, string>>;
  }): Promise<SubscriptionAddonEntity[]> {
    const { subscriptionId, addons, plan, addonConfigs } = params;

    if (addons.length === 0) {
      return [];
    }

    return await this.subscriptionAddonsRepository.createMany(
      addons.map((addon) => {
        const periodPrice = convertAddonPriceToPlanPeriod(addon, plan);
        const adminOnly = this.adminOnlyConfigKeys(addon);
        const fields = parseAddonConfigFields(addon.configSchema).filter((f) => !adminOnly.has(f.key));
        const defaults = addon.configDefaultValues
          ? Object.fromEntries(Object.entries(addon.configDefaultValues).filter(([key]) => !adminOnly.has(key)))
          : undefined;
        const resolved =
          fields.length === 0
            ? defaults
              ? { ...defaults }
              : undefined
            : resolveAddonConfigValues(fields as never, defaults, addonConfigs?.[addon.id]);

        return {
          subscriptionId,
          addonId: addon.id,
          status: 'pending',
          configSnapshot: resolved,
          unitPriceSnapshot: String(periodPrice),
          priceIntervalType: plan.billingIntervalType,
          priceIntervalValue: plan.billingIntervalValue,
          addonNameSnapshot: addon.name,
        };
      }),
    );
  }

  /** Keys the addon's module flags `adminOnly` (secrets used from the catalog defaults, not per subscription). */
  private adminOnlyConfigKeys(addon: AddonEntity): Set<string> {
    if (addon.implementationType !== 'module' || !addon.moduleKey) return new Set();

    const fields = this.addonModuleRegistry.get(addon.moduleKey)?.configFields ?? [];

    return new Set(fields.filter((f) => f.adminOnly === true).map((f) => f.key));
  }

  async listForSubscription(subscriptionId: string): Promise<SubscriptionAddonEntity[]> {
    return await this.subscriptionAddonsRepository.findBySubscriptionId(subscriptionId);
  }

  /**
   * Interpolate and collect cloud-init scripts for selected addons (appended after primary user-data).
   */
  collectInterpolatedCloudInitScripts(
    rows: Array<{ addon?: AddonEntity | null; configSnapshot?: Record<string, unknown> | null }>,
  ): string[] {
    const scripts: string[] = [];

    for (const row of rows) {
      const addon = row.addon;

      if (!addon || addon.implementationType !== 'cloud_init_script' || !addon.scriptTemplate?.trim()) {
        continue;
      }

      scripts.push(this.interpolateAddonScript(addon, addon.scriptTemplate, row.configSnapshot));
    }

    return scripts;
  }

  /** @deprecated Prefer collectInterpolatedCloudInitScripts with subscription rows. */
  collectCloudInitScripts(addons: AddonEntity[]): string[] {
    return addons
      .filter((addon) => addon.implementationType === 'cloud_init_script' && addon.scriptTemplate?.trim())
      .map((addon) => addon.scriptTemplate!.trim());
  }

  /**
   * Appends addon scripts to the user data. Stacks build base64-encoded user data: it is decoded, extended
   * and re-encoded (appending plain text to base64 would drop or corrupt the addon scripts). Plain user data
   * is extended as is.
   */
  appendScriptsToUserData(userData: string, scripts: string[]): string {
    if (scripts.length === 0) {
      return userData;
    }

    const blocks = scripts.map((script, index) => `\n\n# --- Decabill addon script ${index + 1} ---\n${script}`);
    const plain = resolvePlainTextUserData(userData);

    if (plain !== userData) {
      return Buffer.from(`${plain}${blocks.join('')}`).toString('base64');
    }

    return `${userData}${blocks.join('')}`;
  }

  async activateAfterProvisioning(params: {
    subscription: SubscriptionEntity;
    plan: ServicePlanEntity;
    item: SubscriptionItemEntity;
    provider: string;
  }): Promise<void> {
    const rows = await this.subscriptionAddonsRepository.findBySubscriptionId(params.subscription.id);
    const pending = rows.filter((row) => row.status === 'pending' || row.status === 'failed');

    for (const row of pending) {
      const addon = row.addon;

      if (!addon) {
        continue;
      }

      try {
        if (addon.implementationType === 'module') {
          const module = addon.moduleKey ? this.addonModuleRegistry.get(addon.moduleKey) : undefined;

          if (!module) {
            throw new Error(`Addon module "${addon.moduleKey}" is not registered`);
          }

          await module.provision(
            this.buildLifecycleContext({
              subscriptionId: params.subscription.id,
              addon,
              row,
              item: params.item,
              provider: params.provider,
            }),
          );
        }

        row.status = 'active';
        row.activatedAt = new Date();
        row.deactivatedAt = null;
        await this.subscriptionAddonsRepository.save(row);

        this.billingNotificationPublisher.publishAddon('addon.activated', {
          subscription: params.subscription,
          plan: params.plan,
          addon,
          subscriptionAddon: row,
        });
        await this.billingEmailPublisher.publishAddonActivated(params.subscription, params.plan.name, addon.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.error(
          `Failed to provision addon ${addon.key} for subscription ${params.subscription.id}: ${message}`,
        );
        row.status = 'failed';
        await this.subscriptionAddonsRepository.save(row);

        this.billingNotificationPublisher.publishAddon('addon.provision_failed', {
          subscription: params.subscription,
          plan: params.plan,
          addon,
          subscriptionAddon: row,
          errorMessage: message,
        });
        await this.billingEmailPublisher.publishAddonProvisionFailed(params.subscription, params.plan.name, addon.name);
      }
    }
  }

  /**
   * Adds addons to an already provisioned subscription: pending rows are created for addons that are
   * not occupied yet, then each is provisioned through its module or over SSH. Aborts on the first
   * failure so the caller can surface a single error instead of a partially applied selection.
   */
  async provisionMidLife(params: AddonMidLifeProvisionParams): Promise<SubscriptionAddonEntity[]> {
    const requestedIds = [...new Set(params.addonIds)].filter((id) => Boolean(id));

    if (requestedIds.length === 0) {
      return [];
    }

    const existingRows = await this.subscriptionAddonsRepository.findBySubscriptionId(params.subscription.id);
    const occupiedAddonIds = new Set(
      existingRows
        .filter((row) => row.status === 'pending' || row.status === 'active' || row.status === 'tearing_down')
        .map((row) => row.addonId),
    );
    const newAddonIds = requestedIds.filter((id) => !occupiedAddonIds.has(id));

    if (newAddonIds.length === 0) {
      return [];
    }

    const addons = await this.addonsRepository.findByIds(newAddonIds);

    if (addons.length !== newAddonIds.length) {
      throw new BadRequestException('One or more selected addons were not found');
    }

    const addonById = new Map(addons.map((addon) => [addon.id, addon]));
    const rows = await this.createPendingSubscriptionAddons({
      subscriptionId: params.subscription.id,
      addons,
      plan: params.plan,
      addonConfigs: params.addonConfigs,
    });
    const activated: SubscriptionAddonEntity[] = [];

    for (const row of rows) {
      const addon = addonById.get(row.addonId);

      if (!addon) {
        continue;
      }

      try {
        await this.runAddonProvision({ addon, row, request: params });

        row.status = 'active';
        row.activatedAt = new Date();
        row.deactivatedAt = null;
        await this.subscriptionAddonsRepository.save(row);

        this.billingNotificationPublisher.publishAddon('addon.activated', {
          subscription: params.subscription,
          plan: params.plan,
          addon,
          subscriptionAddon: row,
        });
        await this.billingEmailPublisher.publishAddonActivated(params.subscription, params.plan.name, addon.name);
        activated.push(row);
      } catch (error) {
        // Rows left behind by the abort must not stay billable as pending.
        await this.failPendingRows(rows.filter((candidate) => candidate !== row));
        await this.handleMidLifeFailure({
          subscription: params.subscription,
          plan: params.plan,
          addon,
          row,
          error,
          phase: 'provision',
        });
      }
    }

    return activated;
  }

  /**
   * Removes addons from a running subscription. Cloud-init addons only touch the server when the
   * catalog entry defines a reverse script; otherwise the row is deactivated without remote changes.
   */
  async deprovisionMidLife(params: AddonMidLifeDeprovisionParams): Promise<SubscriptionAddonEntity[]> {
    const subscriptionAddonIds = new Set(params.subscriptionAddonIds ?? []);
    const addonIds = new Set(params.addonIds ?? []);

    if (subscriptionAddonIds.size === 0 && addonIds.size === 0) {
      return [];
    }

    const rows = await this.subscriptionAddonsRepository.findBySubscriptionId(params.subscription.id);
    // Pending rows are billable too, so they must be deactivated alongside active ones.
    const matching = rows.filter(
      (row) =>
        (row.status === 'active' || row.status === 'pending') &&
        (subscriptionAddonIds.has(row.id) || addonIds.has(row.addonId)),
    );
    const deactivated: SubscriptionAddonEntity[] = [];

    for (const row of matching) {
      const addon = row.addon;

      if (!addon) {
        continue;
      }

      row.status = 'tearing_down';
      await this.subscriptionAddonsRepository.save(row);

      try {
        await this.runAddonTeardown({ addon, row, request: params });

        row.status = 'inactive';
        row.deactivatedAt = new Date();
        // Config snapshots hold addon secrets; they are worthless once the addon is gone.
        row.configSnapshot = {};
        await this.subscriptionAddonsRepository.save(row);

        this.billingNotificationPublisher.publishAddon('addon.deactivated', {
          subscription: params.subscription,
          plan: params.plan,
          addon,
          subscriptionAddon: row,
        });
        await this.billingEmailPublisher.publishAddonDeactivated(params.subscription, params.plan.name, addon.name);
        deactivated.push(row);
      } catch (error) {
        await this.handleMidLifeFailure({
          subscription: params.subscription,
          plan: params.plan,
          addon,
          row,
          error,
          phase: 'teardown',
        });
      }
    }

    return deactivated;
  }

  async teardownForSubscription(params: {
    subscription: SubscriptionEntity;
    plan: ServicePlanEntity;
    items: SubscriptionItemEntity[];
    providerByItemId: Map<string, string>;
  }): Promise<void> {
    const rows = await this.subscriptionAddonsRepository.findBySubscriptionId(params.subscription.id);
    const active = rows.filter((row) => row.status === 'active' || row.status === 'pending');

    for (const row of active) {
      const addon = row.addon;

      if (!addon) {
        continue;
      }

      row.status = 'tearing_down';
      await this.subscriptionAddonsRepository.save(row);

      const item = params.items[0];
      const provider = item ? (params.providerByItemId.get(item.id) ?? '') : '';

      try {
        if (addon.implementationType === 'module') {
          const module = addon.moduleKey ? this.addonModuleRegistry.get(addon.moduleKey) : undefined;

          if (module) {
            await module.teardown(
              this.buildLifecycleContext({
                subscriptionId: params.subscription.id,
                addon,
                row,
                item,
                provider,
              }),
            );
          }
        } else if (addon.implementationType === 'cloud_init_script' && addon.deprovisionScriptTemplate?.trim()) {
          await this.runDeprovisionScriptIfReachable({ addon, row, item, provider });
        }

        row.status = 'inactive';
        row.deactivatedAt = new Date();
        await this.subscriptionAddonsRepository.save(row);

        this.billingNotificationPublisher.publishAddon('addon.deactivated', {
          subscription: params.subscription,
          plan: params.plan,
          addon,
          subscriptionAddon: row,
        });
        await this.billingEmailPublisher.publishAddonDeactivated(params.subscription, params.plan.name, addon.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.error(
          `Failed to teardown addon ${addon.key} for subscription ${params.subscription.id}: ${message}`,
        );
        row.status = 'failed';
        await this.subscriptionAddonsRepository.save(row);

        this.billingNotificationPublisher.publishAddon('addon.teardown_failed', {
          subscription: params.subscription,
          plan: params.plan,
          addon,
          subscriptionAddon: row,
          errorMessage: message,
        });
        await this.billingEmailPublisher.publishAddonTeardownFailed(params.subscription, params.plan.name, addon.name);
      }
    }
  }

  private buildLifecycleContext(params: {
    subscriptionId: string;
    addon: AddonEntity;
    row: SubscriptionAddonEntity;
    item?: SubscriptionItemEntity;
    provider: string;
  }): AddonLifecycleContext {
    return {
      subscriptionId: params.subscriptionId,
      subscriptionItemId: params.item?.id,
      addonId: params.addon.id,
      addonKey: params.addon.key,
      provider: params.provider,
      providerReference: params.item?.providerReference,
      configSnapshot: params.row.configSnapshot,
      hostname: params.item?.hostname,
    };
  }

  private async runAddonProvision(params: {
    addon: AddonEntity;
    row: SubscriptionAddonEntity;
    request: AddonMidLifeProvisionParams;
  }): Promise<void> {
    const { addon, row } = params;
    const { item, provider, publicIp, subscription } = params.request;

    if (addon.implementationType === 'module') {
      const module = addon.moduleKey ? this.addonModuleRegistry.get(addon.moduleKey) : undefined;

      if (!module) {
        throw new Error(`Addon module "${addon.moduleKey}" is not registered`);
      }

      await module.provision(
        this.buildLifecycleContext({ subscriptionId: subscription.id, addon, row, item, provider }),
      );

      return;
    }

    if (!addon.scriptTemplate?.trim()) {
      throw new Error(`Addon ${addon.key} has no script template to run`);
    }

    await this.runAddonScriptOverSsh({
      addon,
      scriptTemplate: addon.scriptTemplate,
      configSnapshot: row.configSnapshot,
      item,
      provider,
      publicIp,
    });
  }

  private async runAddonTeardown(params: {
    addon: AddonEntity;
    row: SubscriptionAddonEntity;
    request: AddonMidLifeDeprovisionParams;
  }): Promise<void> {
    const { addon, row } = params;
    const { item, provider, publicIp, subscription } = params.request;

    if (addon.implementationType === 'module') {
      const module = addon.moduleKey ? this.addonModuleRegistry.get(addon.moduleKey) : undefined;

      if (!module) {
        throw new Error(`Addon module "${addon.moduleKey}" is not registered`);
      }

      await module.teardown(
        this.buildLifecycleContext({ subscriptionId: subscription.id, addon, row, item, provider }),
      );

      return;
    }

    if (!addon.deprovisionScriptTemplate?.trim()) {
      // No reverse script configured: the row is deactivated without touching the server.
      return;
    }

    await this.runAddonScriptOverSsh({
      addon,
      scriptTemplate: addon.deprovisionScriptTemplate,
      configSnapshot: row.configSnapshot,
      item,
      provider,
      publicIp,
    });
  }

  /**
   * Subscription teardown runs before the server is deleted, but the instance may already be gone
   * or never had an SSH key. In those cases the reverse script is skipped instead of failing.
   */
  private async runDeprovisionScriptIfReachable(params: {
    addon: AddonEntity;
    row: SubscriptionAddonEntity;
    item?: SubscriptionItemEntity;
    provider: string;
  }): Promise<void> {
    const { addon, row, item, provider } = params;

    if (!item?.sshPrivateKey) {
      this.logger.log(`Skipping deprovision script for addon ${addon.key}: no SSH key on subscription item`);

      return;
    }

    const publicIp = await this.resolvePublicIpSafely(item, provider);

    if (!publicIp) {
      this.logger.log(`Skipping deprovision script for addon ${addon.key}: no reachable public IP`);

      return;
    }

    await this.runAddonScriptOverSsh({
      addon,
      scriptTemplate: addon.deprovisionScriptTemplate ?? '',
      configSnapshot: row.configSnapshot,
      item,
      provider,
      publicIp,
    });
  }

  private async runAddonScriptOverSsh(params: {
    addon: AddonEntity;
    scriptTemplate: string;
    configSnapshot?: Record<string, unknown> | null;
    item: SubscriptionItemEntity;
    provider: string;
    publicIp?: string;
  }): Promise<void> {
    const { addon, item } = params;

    if (!item.sshPrivateKey) {
      throw new Error(`Subscription item ${item.id} has no SSH key for addon ${addon.key}`);
    }

    const host = params.publicIp?.trim() || (await this.resolvePublicIp(item, params.provider));

    if (!host) {
      throw new Error(`No public IP available for subscription item ${item.id}`);
    }

    await this.sshExecutor.waitUntilReachable(host, SSH_PORT);

    const script = this.interpolateAddonScript(addon, params.scriptTemplate, params.configSnapshot);
    const result = await this.sshExecutor.exec(host, SSH_PORT, SSH_USER, item.sshPrivateKey, script, {
      commandTimeoutMs: this.resolveSshCommandTimeoutMs(),
    });

    if (result.code !== 0) {
      throw new Error(`Addon ${addon.key} (${addon.id}) script exited with code ${result.code}`);
    }
  }

  private async resolvePublicIp(item: SubscriptionItemEntity, provider: string): Promise<string | undefined> {
    const snapshotIp = item.serverInfoSnapshot?.['publicIp'];

    if (typeof snapshotIp === 'string' && snapshotIp.trim()) {
      return snapshotIp.trim();
    }

    if (!provider || !item.providerReference) {
      return undefined;
    }

    const credentials = getProvisioningCredentials(provider, item.serviceType?.providerDefaults);
    const info = await this.provisioningDispatchService.getServerInfo(provider, item.providerReference, credentials);

    return info?.publicIp?.trim() || undefined;
  }

  private async resolvePublicIpSafely(item: SubscriptionItemEntity, provider: string): Promise<string | undefined> {
    try {
      return await this.resolvePublicIp(item, provider);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Failed to resolve public IP for subscription item ${item.id}: ${message}`);

      return undefined;
    }
  }

  private resolveSshCommandTimeoutMs(): number {
    const configured = Number(process.env['BILLING_ADDON_SSH_COMMAND_TIMEOUT_MS']);

    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SSH_COMMAND_TIMEOUT_MS;
  }

  private interpolateAddonScript(
    addon: AddonEntity,
    scriptTemplate: string,
    configSnapshot?: Record<string, unknown> | null,
  ): string {
    // Secret snapshot keys never reach a script (scripts land in cloud-init user-data / SSH sessions and logs).
    const excluded = new Set([...ADDON_SCRIPT_EXCLUDED_SNAPSHOT_KEYS, ...this.adminOnlyConfigKeys(addon)]);
    const envKeys = parseAddonConfigFields(addon.configSchema)
      .map((field) => field.key)
      .filter((key) => !excluded.has(key));
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(configSnapshot ?? {})) {
      if (excluded.has(key)) {
        continue;
      }

      if (typeof value === 'string') {
        env[key] = value;
      } else if (value !== undefined && value !== null) {
        env[key] = String(value);
      }
    }

    return interpolateAddonScriptTemplate(scriptTemplate.trim(), env, envKeys);
  }

  private async failPendingRows(rows: SubscriptionAddonEntity[]): Promise<void> {
    for (const row of rows) {
      if (row.status !== 'pending') {
        continue;
      }

      row.status = 'failed';
      await this.subscriptionAddonsRepository.save(row);
    }
  }

  /**
   * Marks a mid-life row failed, notifies with a generic message, and aborts the batch.
   * Script output and config values never leave the log line built here.
   */
  private async handleMidLifeFailure(params: {
    subscription: SubscriptionEntity;
    plan: ServicePlanEntity;
    addon: AddonEntity;
    row: SubscriptionAddonEntity;
    error: unknown;
    phase: 'provision' | 'teardown';
  }): Promise<void> {
    const { subscription, plan, addon, row, phase } = params;
    const message = params.error instanceof Error ? params.error.message : String(params.error);
    const isProvision = phase === 'provision';

    this.logger.error(
      `Mid-life addon ${phase} failed for addon ${addon.key} (${addon.id}) on subscription ${subscription.id}: ${message}`,
    );

    row.status = 'failed';
    await this.subscriptionAddonsRepository.save(row);

    this.billingNotificationPublisher.publishAddon(isProvision ? 'addon.provision_failed' : 'addon.teardown_failed', {
      subscription,
      plan,
      addon,
      subscriptionAddon: row,
      errorMessage: isProvision ? PROVISION_FAILED_MESSAGE : TEARDOWN_FAILED_MESSAGE,
    });

    if (isProvision) {
      await this.billingEmailPublisher.publishAddonProvisionFailed(subscription, plan.name, addon.name);
    } else {
      await this.billingEmailPublisher.publishAddonTeardownFailed(subscription, plan.name, addon.name);
    }

    throw new Error(isProvision ? PROVISION_FAILED_MESSAGE : TEARDOWN_FAILED_MESSAGE);
  }
}
