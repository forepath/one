import { CloudInitConfigEntity } from '../../entities/cloud-init-config.entity';
import { buildBillingCloudInitUserData, buildCloudInitConfigFromRequest } from './agent-controller.utils';
import { buildAgentManagerCloudInitConfigFromRequest, buildAgentManagerCloudInitUserData } from './agent-manager.utils';
import {
  buildCustomConfigurationCloudInitConfigFromRequest,
  buildCustomConfigurationCloudInitUserData,
} from './custom-configuration.utils';

export type CloudInitServiceType = 'controller' | 'manager' | 'custom';

export function normalizeCloudInitService(service: string | undefined): CloudInitServiceType {
  if (service === 'manager' || service === 'custom') {
    return service;
  }

  return 'controller';
}

export function buildProvisioningUserData(params: {
  service: CloudInitServiceType;
  effectiveConfig: Record<string, unknown>;
  hostname: string;
  baseDomain: string;
  customTemplate?: CloudInitConfigEntity;
  resolvedCustomEnv?: Record<string, string>;
}): string {
  const { service, effectiveConfig, hostname, baseDomain, customTemplate, resolvedCustomEnv } = params;

  if (service === 'custom') {
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

  if (service === 'manager') {
    return buildAgentManagerCloudInitUserData(
      buildAgentManagerCloudInitConfigFromRequest(effectiveConfig, hostname, baseDomain),
    );
  }

  return buildBillingCloudInitUserData(buildCloudInitConfigFromRequest(effectiveConfig, hostname, baseDomain));
}
