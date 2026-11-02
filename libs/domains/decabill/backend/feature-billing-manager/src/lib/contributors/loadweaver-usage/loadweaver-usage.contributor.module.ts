import { Module, type OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AddonEntity } from '../../entities/addon.entity';
import { AddonsRepository } from '../../repositories/addons.repository';
import { AddonModuleRegistryService, type BillingAddonModule } from '../../services/addon-module-registry.service';
import type { RegisteredContributorNestModule } from '../../utils/contributor-nest.types';
import { LoadweaverUsageCollectService } from './loadweaver-usage-collect.service';
import {
  LOADWEAVER_USAGE_CONFIG_FIELDS,
  LOADWEAVER_USAGE_METERS,
  LOADWEAVER_USAGE_MODULE_KEY,
} from './loadweaver-usage.constants';

/**
 * Loadweaver usage (Loadweaver 3.24): hosters resell capacity of their own Loadweaver clusters. One catalog addon
 * per cluster (admin defaults: API URL + an auditor's PAT with `usage:read`); subscriptions with the addon are billed
 * for the hourly usage of the Loadweaver projects mapped to them (`spec.billing.decabillSubscriptionId`).
 */
export function createLoadweaverUsageAddonModule(collectService: LoadweaverUsageCollectService): BillingAddonModule {
  return {
    key: LOADWEAVER_USAGE_MODULE_KEY,
    displayName: 'Loadweaver usage',
    configFields: LOADWEAVER_USAGE_CONFIG_FIELDS,
    meters: LOADWEAVER_USAGE_METERS,
    async provision(): Promise<void> {
      // Nothing to install: the project mapping is set in Loadweaver (plan / apply by a cluster admin).
    },
    async teardown(): Promise<void> {
      // Usage of the last window is collected before the subscription ends; nothing to remove.
    },
    collectMeters: (ctx) => collectService.collect(ctx),
  };
}

@Module({
  imports: [TypeOrmModule.forFeature([AddonEntity])],
  providers: [AddonsRepository, LoadweaverUsageCollectService],
  exports: [LoadweaverUsageCollectService],
})
export class LoadweaverUsageContributorModule implements OnModuleInit {
  constructor(
    private readonly addonModuleRegistry: AddonModuleRegistryService,
    private readonly collectService: LoadweaverUsageCollectService,
  ) {}

  onModuleInit(): void {
    this.addonModuleRegistry.register(createLoadweaverUsageAddonModule(this.collectService));
  }
}

export const LOADWEAVER_USAGE_NEST_REGISTRATION: RegisteredContributorNestModule = {
  source: 'addon',
  sourceKey: LOADWEAVER_USAGE_MODULE_KEY,
  nestModule: LoadweaverUsageContributorModule,
};
