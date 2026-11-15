import { Module, type OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AddonEntity } from '../../entities/addon.entity';
import { ContainerStatsSampleEntity } from '../../entities/container-stats-sample.entity';
import { ContainerStatsSummaryEntity } from '../../entities/container-stats-summary.entity';
import { ServicePlanEntity } from '../../entities/service-plan.entity';
import { SubscriptionAddonEntity } from '../../entities/subscription-addon.entity';
import { SubscriptionItemEntity } from '../../entities/subscription-item.entity';
import { SubscriptionEntity } from '../../entities/subscription.entity';
import { AddonsRepository } from '../../repositories/addons.repository';
import { ContainerStatsSamplesRepository } from '../../repositories/container-stats-samples.repository';
import { ContainerStatsSummariesRepository } from '../../repositories/container-stats-summaries.repository';
import { ServicePlansRepository } from '../../repositories/service-plans.repository';
import { SubscriptionAddonsRepository } from '../../repositories/subscription-addons.repository';
import { SubscriptionItemsRepository } from '../../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../../repositories/subscriptions.repository';
import { AddonModuleRegistryService } from '../../services/addon-module-registry.service';
import type { RegisteredContributorNestModule } from '../../utils/contributor-nest.types';

import { createBuiltinAddonModules } from './builtin-addon-modules';
import { AdminContainerManagerController } from './controllers/admin-container-manager.controller';
import { ContainerManagerController } from './controllers/container-manager.controller';
import { ContainerManagerCatalogService } from './services/container-manager-catalog.service';
import { ContainerManagerCollectService } from './services/container-manager-collect.service';
import { ContainerManagerService } from './services/container-manager.service';

export const CONTAINER_MANAGER_CONTRIBUTOR_KEY = 'container-manager';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubscriptionEntity,
      SubscriptionItemEntity,
      SubscriptionAddonEntity,
      ServicePlanEntity,
      AddonEntity,
      ContainerStatsSampleEntity,
      ContainerStatsSummaryEntity,
    ]),
  ],
  controllers: [ContainerManagerController, AdminContainerManagerController],
  providers: [
    SubscriptionsRepository,
    SubscriptionItemsRepository,
    SubscriptionAddonsRepository,
    ServicePlansRepository,
    AddonsRepository,
    ContainerStatsSamplesRepository,
    ContainerStatsSummariesRepository,
    ContainerManagerService,
    ContainerManagerCollectService,
    ContainerManagerCatalogService,
  ],
  exports: [ContainerManagerService, ContainerManagerCollectService, ContainerManagerCatalogService],
})
export class ContainerManagerContributorModule implements OnModuleInit {
  constructor(
    private readonly addonModuleRegistry: AddonModuleRegistryService,
    private readonly collectService: ContainerManagerCollectService,
  ) {}

  onModuleInit(): void {
    for (const module of createBuiltinAddonModules(this.collectService)) {
      this.addonModuleRegistry.register(module);
    }
  }
}

export const CONTAINER_MANAGER_NEST_REGISTRATION: RegisteredContributorNestModule = {
  source: 'addon',
  sourceKey: CONTAINER_MANAGER_CONTRIBUTOR_KEY,
  nestModule: ContainerManagerContributorModule,
};
