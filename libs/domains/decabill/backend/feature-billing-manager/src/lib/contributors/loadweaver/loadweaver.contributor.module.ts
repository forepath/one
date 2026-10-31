import { Module, type OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SubscriptionItemEntity } from '../../entities/subscription-item.entity';
import { SubscriptionEntity } from '../../entities/subscription.entity';
import { SubscriptionItemsRepository } from '../../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../../repositories/subscriptions.repository';
import { IntegratedStackRegistryService } from '../../services/integrated-stack-registry.service';
import {
  IntegratedProvisioningService,
  integratedProvisioningServiceLabel,
} from '../../utils/cloud-init/integrated-provisioning-service';
import type { RegisteredContributorNestModule } from '../../utils/contributor-nest.types';

import { AdminLoadweaverClusterController, LoadweaverClusterController } from './loadweaver-cluster.controller';
import { LoadweaverClusterService } from './loadweaver-cluster.service';
import { LoadweaverFleetTeardownService } from './loadweaver-fleet-teardown.service';
import {
  LOADWEAVER_ADMIN_CLAIM_TOKEN_KEY,
  LOADWEAVER_CLUSTER_TAB_ID,
  buildLoadweaverCloudInitConfigFromRequest,
  buildLoadweaverCloudInitUserData,
  buildLoadweaverUpdateCommand,
  generateLoadweaverAdminClaimToken,
} from './loadweaver.utils';

export const LOADWEAVER_CONTRIBUTOR_KEY = IntegratedProvisioningService.Loadweaver;

@Module({
  imports: [TypeOrmModule.forFeature([SubscriptionEntity, SubscriptionItemEntity])],
  controllers: [LoadweaverClusterController, AdminLoadweaverClusterController],
  providers: [
    SubscriptionsRepository,
    SubscriptionItemsRepository,
    LoadweaverClusterService,
    LoadweaverFleetTeardownService,
  ],
  exports: [LoadweaverClusterService],
})
export class LoadweaverContributorModule implements OnModuleInit {
  constructor(
    private readonly integratedStackRegistry: IntegratedStackRegistryService,
    private readonly fleetTeardown: LoadweaverFleetTeardownService,
  ) {}

  onModuleInit(): void {
    this.integratedStackRegistry.register({
      key: LOADWEAVER_CONTRIBUTOR_KEY,
      displayName: integratedProvisioningServiceLabel(LOADWEAVER_CONTRIBUTOR_KEY),
      serviceTabs: [{ id: LOADWEAVER_CLUSTER_TAB_ID, label: 'Cluster', order: 10 }],
      // One-time admin claim token per provisioning (encrypted item config; shown in the Cluster tab until claimed).
      prepareProvisioningConfig: () => ({ [LOADWEAVER_ADMIN_CLAIM_TOKEN_KEY]: generateLoadweaverAdminClaimToken() }),
      buildUserData: ({ hostname, baseDomain, effectiveConfig }) =>
        buildLoadweaverCloudInitUserData(
          buildLoadweaverCloudInitConfigFromRequest(effectiveConfig, hostname, baseDomain),
        ),
      // Loadweaver updates itself (own rollout); this only re-pins the console image, never pulls the cluster.
      buildUpdateCommand: buildLoadweaverUpdateCommand,
      selfUpdating: true,
      // Final backup + read-only grace through the Loadweaver fleet service (only with LOADWEAVER_FLEET_URL / _TOKEN).
      jobs: [this.fleetTeardown.jobDefinition()],
    });
  }
}

export const LOADWEAVER_NEST_REGISTRATION: RegisteredContributorNestModule = {
  source: 'integrated',
  sourceKey: LOADWEAVER_CONTRIBUTOR_KEY,
  nestModule: LoadweaverContributorModule,
};
