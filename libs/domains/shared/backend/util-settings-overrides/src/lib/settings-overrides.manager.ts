import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';

import {
  GLOBAL_SETTINGS_SCOPE,
  SettingDefinition,
  SettingsLevel,
  SettingsOverrideRecord,
  SettingStateView,
} from './setting-definition.types';
import { normalizeSettingValue, SettingValueValidationError } from './setting-value.validation';
import {
  type DescribeSettingsOptions,
  describeSettings,
  installSettingsOverridesEnv,
  registerSettingDefinitions,
  removeSettingsOverride,
  replaceSettingsOverrides,
  setSettingsOverride,
} from './settings-overrides.registry';

/** Persistence of override rows (values are encrypted at rest by the entity transformer). */
export interface SettingsOverridesStore {
  findAll(): Promise<SettingsOverrideRecord[]>;
  upsert(record: SettingsOverrideRecord, updatedByUserId?: string | null): Promise<void>;
  remove(scopeKey: string, settingKey: string): Promise<boolean>;
}

export const SETTINGS_OVERRIDES_REFRESH_INTERVAL_ENV = 'SETTINGS_OVERRIDES_REFRESH_INTERVAL_MS';
const DEFAULT_REFRESH_INTERVAL_MS = 30_000;

/** Interval in which every process re-reads the overrides (other API / worker replicas pick up changes). */
export function readSettingsOverridesRefreshIntervalMs(): number {
  const parsed = Number.parseInt(process.env[SETTINGS_OVERRIDES_REFRESH_INTERVAL_ENV] ?? '', 10);

  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : DEFAULT_REFRESH_INTERVAL_MS;
}

/**
 * Loads, refreshes and edits the overrides of one backend. Authorization (who may edit which level / tenant)
 * is the caller's responsibility; this class validates keys, scopes and values.
 */
export class SettingsOverridesManager {
  private readonly logger = new Logger(SettingsOverridesManager.name);
  private readonly byKey: Map<string, SettingDefinition>;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: SettingsOverridesStore,
    private readonly definitions: readonly SettingDefinition[],
  ) {
    this.byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  }

  getDefinitions(): readonly SettingDefinition[] {
    return this.definitions;
  }

  async start(refreshIntervalMs = readSettingsOverridesRefreshIntervalMs()): Promise<void> {
    registerSettingDefinitions(this.definitions);
    installSettingsOverridesEnv();
    await this.reloadSafely();

    if (!this.timer) {
      this.timer = setInterval(() => void this.reloadSafely(), refreshIntervalMs);
      this.timer.unref?.();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async reload(): Promise<void> {
    replaceSettingsOverrides(await this.store.findAll());
  }

  private async reloadSafely(): Promise<void> {
    try {
      await this.reload();
    } catch (error) {
      this.logger.warn(`Settings overrides reload failed: ${(error as Error).message}`);
    }
  }

  async list(level: SettingsLevel, tenantId?: string, options?: DescribeSettingsOptions): Promise<SettingStateView[]> {
    await this.reload();

    return describeSettings(this.definitions, level, tenantId, options);
  }

  async upsert(
    level: SettingsLevel,
    settingKey: string,
    rawValue: unknown,
    tenantId?: string,
    updatedByUserId?: string | null,
    options?: DescribeSettingsOptions,
  ): Promise<SettingStateView> {
    const definition = this.requireDefinition(level, settingKey);
    const scopeKey = this.scopeKeyFor(level, tenantId);
    let value: string;

    try {
      value = normalizeSettingValue(definition, rawValue);
    } catch (error) {
      if (error instanceof SettingValueValidationError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }

    await this.store.upsert({ scopeKey, settingKey, value }, updatedByUserId);
    setSettingsOverride(scopeKey, settingKey, value);
    await this.reloadSafely();

    return this.describeOne(definition, level, tenantId, options);
  }

  async reset(
    level: SettingsLevel,
    settingKey: string,
    tenantId?: string,
    options?: DescribeSettingsOptions,
  ): Promise<SettingStateView> {
    const definition = this.requireDefinition(level, settingKey);
    const scopeKey = this.scopeKeyFor(level, tenantId);

    await this.store.remove(scopeKey, settingKey);
    removeSettingsOverride(scopeKey, settingKey);
    await this.reloadSafely();

    return this.describeOne(definition, level, tenantId, options);
  }

  private describeOne(
    definition: SettingDefinition,
    level: SettingsLevel,
    tenantId?: string,
    options?: DescribeSettingsOptions,
  ): SettingStateView {
    return describeSettings([definition], level, tenantId, options)[0];
  }

  private scopeKeyFor(level: SettingsLevel, tenantId?: string): string {
    if (level === 'global') {
      return GLOBAL_SETTINGS_SCOPE;
    }

    if (!tenantId?.trim() || tenantId === GLOBAL_SETTINGS_SCOPE) {
      throw new BadRequestException('A tenant is required for tenant settings');
    }

    return tenantId;
  }

  private requireDefinition(level: SettingsLevel, settingKey: string): SettingDefinition {
    const definition = this.byKey.get(settingKey);

    if (!definition) {
      throw new NotFoundException(`Unknown setting: ${settingKey}`);
    }

    if (level === 'tenant' && definition.scope !== 'tenant') {
      throw new BadRequestException(`${settingKey} can only be overridden for all tenants`);
    }

    return definition;
  }
}
