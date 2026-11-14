import { Injectable } from '@nestjs/common';

import { CloudInitConfigEntity } from '../entities/cloud-init-config.entity';
import {
  buildBareServerCloudInitConfigFromRequest,
  buildBareServerCloudInitUserData,
} from '../utils/cloud-init/bare-server.utils';
import {
  buildCustomConfigurationCloudInitConfigFromRequest,
  buildCustomConfigurationCloudInitUserData,
} from '../utils/cloud-init/custom-configuration.utils';
import {
  CloudInitServiceType,
  canonicalizeIntegratedProvisioningService,
} from '../utils/cloud-init/integrated-provisioning-service';

import { IntegratedStackRegistryService } from './integrated-stack-registry.service';

export interface BuildProvisioningUserDataParams {
  service: string | undefined;
  effectiveConfig: Record<string, unknown>;
  hostname: string;
  baseDomain: string;
  customTemplate?: CloudInitConfigEntity;
  resolvedCustomEnv?: Record<string, string>;
}

/**
 * Builds cloud-init user-data for custom jsonb templates, registered integrated stacks, or bare servers
 * (`none`: SSH access baseline only, no product stack).
 * Unknown integrated keys fail closed (no silent fallback to agenstra-controller).
 */
@Injectable()
export class CloudInitDispatchService {
  constructor(private readonly integratedStackRegistry: IntegratedStackRegistryService) {}

  buildUserData(params: BuildProvisioningUserDataParams): string {
    const { service, effectiveConfig, hostname, baseDomain, customTemplate, resolvedCustomEnv } = params;
    const trimmed = service?.trim();

    if (trimmed === CloudInitServiceType.None) {
      return buildBareServerCloudInitUserData(buildBareServerCloudInitConfigFromRequest(effectiveConfig));
    }

    if (trimmed === CloudInitServiceType.Custom) {
      if (!customTemplate || !resolvedCustomEnv) {
        throw new Error('Custom CloudInit provisioning requires template and resolved environment variables');
      }

      return buildCustomConfigurationCloudInitUserData(
        customTemplate,
        buildCustomConfigurationCloudInitConfigFromRequest(
          customTemplate,
          resolvedCustomEnv,
          effectiveConfig,
          hostname,
          baseDomain,
        ),
      );
    }

    const stackKey = canonicalizeIntegratedProvisioningService(trimmed ?? '');

    if (!stackKey) {
      throw new Error('Unknown integrated CloudInit stack');
    }

    const stack = this.integratedStackRegistry.get(stackKey);

    if (!stack?.buildUserData) {
      throw new Error(`Integrated CloudInit stack is not provisionable: ${stackKey}`);
    }

    return stack.buildUserData({ hostname, baseDomain, effectiveConfig });
  }
}
