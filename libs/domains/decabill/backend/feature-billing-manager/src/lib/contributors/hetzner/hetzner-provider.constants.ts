import { applyProviderConfigFieldScopes } from '../../utils/provider-config-schema.utils';
import { HETZNER_ENV_DEFAULT_FIELDS } from '../../utils/provider-env-defaults.utils';
import { HOST_CLOUD_INIT_COMPATIBILITY_GROUP } from '../../utils/provider-selection.utils';
import { HOST_PROVIDER_CONFIG_PROPERTIES } from '../shared/host-provider-config.properties';

export const HETZNER_PROVIDER_ID = 'hetzner';

export const HETZNER_CONFIG_SCHEMA: Record<string, unknown> = {
  required: ['serverType', 'location', 'service'],
  basePriceFromField: 'serverType',
  properties: applyProviderConfigFieldScopes(
    {
      ...HOST_PROVIDER_CONFIG_PROPERTIES,
      serverType: {
        type: 'string',
        description: 'Hetzner server type (options and price from API)',
      },
      location: {
        type: 'string',
        description: 'Hetzner location',
        enum: ['fsn1', 'nbg1', 'hel1', 'ash', 'hil', 'sgp'],
      },
      firewallId: { type: 'number', description: 'Optional firewall ID to attach to server' },
    },
    ['serverType', 'location', 'firewallId'],
  ),
};

export const HETZNER_PROVIDER_METADATA = {
  id: HETZNER_PROVIDER_ID,
  displayName: 'Hetzner Cloud-Init',
  compatibilityGroup: HOST_CLOUD_INIT_COMPATIBILITY_GROUP,
  configSchema: HETZNER_CONFIG_SCHEMA,
  envDefaultFields: HETZNER_ENV_DEFAULT_FIELDS,
  supportsAddons: true,
  supportsServerTypeUpgrade: true,
  supportsServerTypeDowngrade: true,
} as const;
