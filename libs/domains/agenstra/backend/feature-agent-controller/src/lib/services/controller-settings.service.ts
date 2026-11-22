import {
  SettingsOverridesManager,
  SettingsOverviewResponse,
  SettingStateView,
} from '@forepath/shared/backend/util-settings-overrides';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { CONTROLLER_SETTINGS, CONTROLLER_SETTINGS_CATEGORIES } from '../constants/controller-settings.catalog';
import { ControllerSettingsOverridesRepository } from '../repositories/controller-settings-overrides.repository';

/**
 * Console overrides of controller settings: override (database) → environment variable.
 * Overrides apply to `process.env` reads of this process; other processes pick them up on their next refresh.
 */
@Injectable()
export class ControllerSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly manager: SettingsOverridesManager;

  constructor(repository: ControllerSettingsOverridesRepository) {
    this.manager = new SettingsOverridesManager(repository, CONTROLLER_SETTINGS);
  }

  async onModuleInit(): Promise<void> {
    await this.manager.start();
  }

  onModuleDestroy(): void {
    this.manager.stop();
  }

  async getOverview(): Promise<SettingsOverviewResponse> {
    return {
      level: 'global',
      tenantId: null,
      homeTenantId: null,
      canManageGlobal: true,
      viewableTenants: [],
      categories: [...CONTROLLER_SETTINGS_CATEGORIES],
      settings: await this.manager.list('global'),
    };
  }

  async upsert(settingKey: string, value: unknown, updatedByUserId?: string | null): Promise<SettingStateView> {
    return await this.manager.upsert('global', settingKey, value, undefined, updatedByUserId);
  }

  async reset(settingKey: string): Promise<SettingStateView> {
    return await this.manager.reset('global', settingKey);
  }
}
