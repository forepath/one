import { Injectable } from '@nestjs/common';

import { CloudInitConfigEntity } from '../entities/cloud-init-config.entity';
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
 * Builds cloud-init user-data for custom jsonb templates or registered integrated stacks.
 * Unknown integrated keys fail closed (no silent fallback to agenstra-controller).
 */
@Injectable()
export class CloudInitDispatchService {
  constructor(private readonly integratedStackRegistry: IntegratedStackRegistryService) {}

  /**
   * Per-provisioning secrets of an integrated stack (see `IntegratedStackModule.prepareProvisioningConfig`); empty
   * for custom templates and stacks without the hook. Callers merge them into the effective config and persist them in
   * the item's encrypted config snapshot before building the user-data.
   */
  prepareProvisioningConfig(service: string | undefined): Record<string, unknown> {
    const trimmed = service?.trim();

    if (!trimmed || trimmed === CloudInitServiceType.Custom) {
      return {};
    }

    const stackKey = canonicalizeIntegratedProvisioningService(trimmed);
    const stack = stackKey ? this.integratedStackRegistry.get(stackKey) : undefined;

    return stack?.prepareProvisioningConfig?.() ?? {};
  }

  buildUserData(params: BuildProvisioningUserDataParams): string {
    const { service, effectiveConfig, hostname, baseDomain, customTemplate, resolvedCustomEnv } = params;
    const trimmed = service?.trim();

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
