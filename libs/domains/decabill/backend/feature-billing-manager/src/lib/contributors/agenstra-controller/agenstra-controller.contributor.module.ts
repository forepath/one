import { Module, type OnModuleInit } from '@nestjs/common';

import { IntegratedStackRegistryService } from '../../services/integrated-stack-registry.service';
import {
  IntegratedProvisioningService,
  integratedProvisioningServiceLabel,
} from '../../utils/cloud-init/integrated-provisioning-service';
import type { RegisteredContributorNestModule } from '../../utils/contributor-nest.types';

import {
  buildAgentControllerUpdateCommand,
  buildBillingCloudInitUserData,
  buildCloudInitConfigFromRequest,
} from './agent-controller.utils';

export const AGENSTRA_CONTROLLER_CONTRIBUTOR_KEY = IntegratedProvisioningService.AgenstraController;

@Module({})
export class AgenstraControllerContributorModule implements OnModuleInit {
  constructor(private readonly integratedStackRegistry: IntegratedStackRegistryService) {}

  onModuleInit(): void {
    this.integratedStackRegistry.register({
      key: AGENSTRA_CONTROLLER_CONTRIBUTOR_KEY,
      displayName: integratedProvisioningServiceLabel(AGENSTRA_CONTROLLER_CONTRIBUTOR_KEY),
      serviceTabs: [],
      buildUserData: ({ hostname, baseDomain, effectiveConfig }) =>
        buildBillingCloudInitUserData(buildCloudInitConfigFromRequest(effectiveConfig, hostname, baseDomain)),
      buildUpdateCommand: buildAgentControllerUpdateCommand,
    });
  }
}

export const AGENSTRA_CONTROLLER_NEST_REGISTRATION: RegisteredContributorNestModule = {
  source: 'integrated',
  sourceKey: AGENSTRA_CONTROLLER_CONTRIBUTOR_KEY,
  nestModule: AgenstraControllerContributorModule,
};
