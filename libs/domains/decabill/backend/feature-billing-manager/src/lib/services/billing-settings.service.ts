import {
  SettingsLevel,
  SettingsOverridesManager,
  SettingsOverviewResponse,
  SettingStateView,
} from '@forepath/shared/backend/util-settings-overrides';
import { ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { BILLING_SETTINGS, BILLING_SETTINGS_CATEGORIES } from '../constants/billing-settings.catalog';
import { BillingSettingsOverridesRepository } from '../repositories/billing-settings-overrides.repository';
import { resolveAdminViewTenant } from '../utils/admin-view-tenant.util';
import { getRequiredTenantId } from '../utils/tenant-query.utils';

import { BillingTenantService } from './billing-tenant.service';
import { TenantsGlobalViewsConfigService } from './tenants-global-views-config.service';

interface ResolvedSettingsTarget {
  level: SettingsLevel;
  tenantId: string | undefined;
}

/**
 * Console overrides of billing manager settings: tenant override → override for all tenants → environment.
 *
 * Access: every billing admin manages the tenant settings of the own tenant. Admins of tenants listed in
 * `TENANTS_ALLOW_GLOBAL_VIEWS` additionally manage the overrides for all tenants and the settings of every
 * configured tenant (`viewTenantId`).
 */
@Injectable()
export class BillingSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly manager: SettingsOverridesManager;

  constructor(
    repository: BillingSettingsOverridesRepository,
    private readonly globalViews: TenantsGlobalViewsConfigService,
    private readonly tenants: BillingTenantService,
  ) {
    this.manager = new SettingsOverridesManager(repository, BILLING_SETTINGS);
  }

  async onModuleInit(): Promise<void> {
    await this.manager.start();
  }

  onModuleDestroy(): void {
    this.manager.stop();
  }

  async getOverview(level?: SettingsLevel, viewTenantId?: string): Promise<SettingsOverviewResponse> {
    const homeTenantId = getRequiredTenantId();
    const canManageGlobal = this.globalViews.isGlobalViewsAllowedForTenant(homeTenantId);
    const target = this.resolveTarget(level ?? (canManageGlobal && !viewTenantId ? 'global' : 'tenant'), viewTenantId);

    return {
      level: target.level,
      tenantId: target.tenantId ?? null,
      homeTenantId,
      canManageGlobal,
      viewableTenants: canManageGlobal ? [...this.tenants.getConfiguredTenants()] : [homeTenantId],
      categories: [...BILLING_SETTINGS_CATEGORIES],
      settings: await this.manager.list(target.level, target.tenantId, { revealInherited: canManageGlobal }),
    };
  }

  async upsert(
    settingKey: string,
    value: unknown,
    level: SettingsLevel | undefined,
    viewTenantId: string | undefined,
    updatedByUserId?: string | null,
  ): Promise<SettingStateView> {
    const target = this.resolveTarget(level ?? 'tenant', viewTenantId);

    return await this.manager.upsert(target.level, settingKey, value, target.tenantId, updatedByUserId, {
      revealInherited: this.canManageGlobal(),
    });
  }

  async reset(settingKey: string, level: SettingsLevel | undefined, viewTenantId: string | undefined) {
    const target = this.resolveTarget(level ?? 'tenant', viewTenantId);

    return await this.manager.reset(target.level, settingKey, target.tenantId, {
      revealInherited: this.canManageGlobal(),
    });
  }

  /** Only global-view tenants may see the deployment's (all tenants / environment) values. */
  private canManageGlobal(): boolean {
    return this.globalViews.isGlobalViewsAllowedForTenant(getRequiredTenantId());
  }

  private resolveTarget(level: SettingsLevel, viewTenantId?: string): ResolvedSettingsTarget {
    const homeTenantId = getRequiredTenantId();

    if (level === 'global') {
      if (!this.globalViews.isGlobalViewsAllowedForTenant(homeTenantId)) {
        throw new ForbiddenException('Settings for all tenants are not allowed for this tenant');
      }

      return { level, tenantId: undefined };
    }

    const tenantId = resolveAdminViewTenant(this.globalViews, viewTenantId);

    if (!this.tenants.isValidTenant(tenantId)) {
      throw new NotFoundException(`Unknown tenant: ${tenantId}`);
    }

    return { level, tenantId };
  }
}
