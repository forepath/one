import { Module, type OnModuleInit } from '@nestjs/common';

import { IntegratedStackRegistryService } from '../../services/integrated-stack-registry.service';
import {
  IntegratedProvisioningService,
  integratedProvisioningServiceLabel,
} from '../../utils/cloud-init/integrated-provisioning-service';
import type { RegisteredContributorNestModule } from '../../utils/contributor-nest.types';

import {
  buildAgentManagerCloudInitConfigFromRequest,
  buildAgentManagerCloudInitUserData,
  buildAgentManagerUpdateCommand,
} from './agent-manager.utils';

export const AGENSTRA_MANAGER_CONTRIBUTOR_KEY = IntegratedProvisioningService.AgenstraManager;

@Module({})
export class AgenstraManagerContributorModule implements OnModuleInit {
  constructor(private readonly integratedStackRegistry: IntegratedStackRegistryService) {}

  onModuleInit(): void {
    this.integratedStackRegistry.register({
      key: AGENSTRA_MANAGER_CONTRIBUTOR_KEY,
      displayName: integratedProvisioningServiceLabel(AGENSTRA_MANAGER_CONTRIBUTOR_KEY),
      serviceTabs: [],
      buildUserData: ({ hostname, baseDomain, effectiveConfig }) =>
        buildAgentManagerCloudInitUserData(
          buildAgentManagerCloudInitConfigFromRequest(effectiveConfig, hostname, baseDomain),
        ),
      buildUpdateCommand: buildAgentManagerUpdateCommand,
    });
  }
}

export const AGENSTRA_MANAGER_NEST_REGISTRATION: RegisteredContributorNestModule = {
  source: 'integrated',
  sourceKey: AGENSTRA_MANAGER_CONTRIBUTOR_KEY,
  nestModule: AgenstraManagerContributorModule,
};
