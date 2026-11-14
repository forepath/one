import { applyProviderConfigFieldScopes } from '../../utils/provider-config-schema.utils';
import { DIGITALOCEAN_ENV_DEFAULT_FIELDS } from '../../utils/provider-env-defaults.utils';
import { HOST_CLOUD_INIT_COMPATIBILITY_GROUP } from '../../utils/provider-selection.utils';
import { HOST_PROVIDER_CONFIG_PROPERTIES } from '../shared/host-provider-config.properties';

export const DIGITAL_OCEAN_PROVIDER_ID = 'digital-ocean';

export const DIGITAL_OCEAN_CONFIG_SCHEMA: Record<string, unknown> = {
  required: ['serverType', 'region', 'service'],
  basePriceFromField: 'serverType',
  properties: applyProviderConfigFieldScopes(
    {
      ...HOST_PROVIDER_CONFIG_PROPERTIES,
      serverType: {
        type: 'string',
        description: 'DigitalOcean droplet size (options and price from API)',
      },
      region: {
        type: 'string',
        description: 'DigitalOcean region',
        enum: ['ams3', 'blr1', 'fra1', 'lon1', 'nyc1', 'nyc3', 'sfo2', 'sfo3', 'sgp1', 'syd1', 'tor1'],
      },
    },
    ['serverType', 'region'],
  ),
};

export const DIGITAL_OCEAN_PROVIDER_METADATA = {
  id: DIGITAL_OCEAN_PROVIDER_ID,
  displayName: 'DigitalOcean Cloud-Init',
  compatibilityGroup: HOST_CLOUD_INIT_COMPATIBILITY_GROUP,
  configSchema: DIGITAL_OCEAN_CONFIG_SCHEMA,
  envDefaultFields: DIGITALOCEAN_ENV_DEFAULT_FIELDS,
  supportsAddons: true,
  supportsServerTypeUpgrade: true,
  supportsServerTypeDowngrade: true,
} as const;
