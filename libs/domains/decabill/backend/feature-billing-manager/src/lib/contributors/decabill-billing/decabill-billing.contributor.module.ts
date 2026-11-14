import { Module, type OnModuleInit } from '@nestjs/common';

import { IntegratedStackRegistryService } from '../../services/integrated-stack-registry.service';
import {
  IntegratedProvisioningService,
  integratedProvisioningServiceLabel,
} from '../../utils/cloud-init/integrated-provisioning-service';
import type { RegisteredContributorNestModule } from '../../utils/contributor-nest.types';

import {
  buildDecabillBillingCloudInitConfigFromRequest,
  buildDecabillBillingCloudInitUserData,
  buildDecabillBillingUpdateCommand,
} from './decabill-billing.utils';

export const DECABILL_BILLING_CONTRIBUTOR_KEY = IntegratedProvisioningService.DecabillBilling;

@Module({})
export class DecabillBillingContributorModule implements OnModuleInit {
  constructor(private readonly integratedStackRegistry: IntegratedStackRegistryService) {}

  onModuleInit(): void {
    this.integratedStackRegistry.register({
      key: DECABILL_BILLING_CONTRIBUTOR_KEY,
      displayName: integratedProvisioningServiceLabel(DECABILL_BILLING_CONTRIBUTOR_KEY),
      serviceTabs: [],
      buildUserData: ({ hostname, baseDomain, effectiveConfig }) =>
        buildDecabillBillingCloudInitUserData(
          buildDecabillBillingCloudInitConfigFromRequest(effectiveConfig, hostname, baseDomain),
        ),
      buildUpdateCommand: buildDecabillBillingUpdateCommand,
    });
  }
}

export const DECABILL_BILLING_NEST_REGISTRATION: RegisteredContributorNestModule = {
  source: 'integrated',
  sourceKey: DECABILL_BILLING_CONTRIBUTOR_KEY,
  nestModule: DecabillBillingContributorModule,
};
