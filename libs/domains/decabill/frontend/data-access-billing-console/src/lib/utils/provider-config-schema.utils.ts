export type ProviderConfigFieldScope = 'server' | 'product' | 'internal';
export type IntegratedProductService = 'controller' | 'manager';

export type ConfigSchemaPropertyType = 'string' | 'number' | 'boolean' | 'object';

export interface ConfigSchemaPropertyDefinition {
  type?: string;
  description?: string;
  enum?: unknown[];
  visible?: boolean;
  scope?: ProviderConfigFieldScope;
  productServices?: IntegratedProductService[];
  properties?: Record<string, ConfigSchemaPropertyDefinition>;
}

const CONFIG_FIELD_LABEL_OVERRIDES: Record<string, string> = {
  smtp: 'SMTP',
  keycloak: 'Keycloak',
  git: 'Git',
  apiKey: 'API key',
  staticApiKey: 'Static API key',
  cursorApiKey: 'Cursor API key',
  hetznerApiToken: 'Hetzner API token',
  digitaloceanApiToken: 'DigitalOcean API token',
  authenticationMethod: 'Authentication method',
  disableSignup: 'Disable signup',
  serverUrl: 'Server URL',
  authServerUrl: 'Auth server URL',
  clientId: 'Client ID',
  clientSecret: 'Client secret',
  repositoryUrl: 'Repository URL',
  setupMode: 'Repository setup',
  commitAuthorName: 'Commit author name',
  commitAuthorEmail: 'Commit author email',
  privateKey: 'Private key',
};

export function getSchemaPropertyType(property: ConfigSchemaPropertyDefinition | undefined): ConfigSchemaPropertyType {
  const type = property?.type;

  if (type === 'number' || type === 'boolean' || type === 'object') {
    return type;
  }

  return 'string';
}

export function isObjectSchemaProperty(property: ConfigSchemaPropertyDefinition | undefined): boolean {
  return getSchemaPropertyType(property) === 'object' && !!property?.properties;
}

export function getObjectSchemaPropertyKeys(property: ConfigSchemaPropertyDefinition | undefined): string[] {
  if (!isObjectSchemaProperty(property)) {
    return [];
  }

  return Object.keys(property?.properties ?? {});
}

export function getNestedSchemaProperty(
  property: ConfigSchemaPropertyDefinition | undefined,
  nestedKey: string,
): ConfigSchemaPropertyDefinition | undefined {
  return property?.properties?.[nestedKey];
}

export function humanizeConfigFieldKey(key: string): string {
  if (CONFIG_FIELD_LABEL_OVERRIDES[key]) {
    return CONFIG_FIELD_LABEL_OVERRIDES[key];
  }

  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function isSensitiveConfigFieldKey(key: string): boolean {
  const normalized = key.toLowerCase();

  return (
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('apikey') ||
    normalized.includes('privatekey')
  );
}

const INTERNAL_PROVIDER_KEYS = new Set(['service', 'cloudInitConfigId', 'cloudInitConfigIds', 'provisioningOptions']);

export function getProviderConfigFieldScope(
  key: string,
  property: ConfigSchemaPropertyDefinition | undefined,
): ProviderConfigFieldScope {
  if (property?.scope === 'server' || property?.scope === 'product' || property?.scope === 'internal') {
    return property.scope;
  }

  if (INTERNAL_PROVIDER_KEYS.has(key)) {
    return 'internal';
  }

  if (property?.visible === false) {
    return 'product';
  }

  return 'server';
}

export function getProductServicesForProperty(
  property: ConfigSchemaPropertyDefinition | undefined,
): IntegratedProductService[] {
  const services = property?.productServices;

  if (Array.isArray(services) && services.length > 0) {
    return services.filter(
      (service): service is IntegratedProductService => service === 'controller' || service === 'manager',
    );
  }

  return ['controller', 'manager'];
}

export function getServerProviderConfigKeys(
  schema: Record<string, ConfigSchemaPropertyDefinition> | null | undefined,
  keys: string[],
): string[] {
  return keys.filter((key) => getProviderConfigFieldScope(key, schema?.[key]) === 'server');
}

export function getProductProviderConfigKeys(
  schema: Record<string, ConfigSchemaPropertyDefinition> | null | undefined,
  keys: string[],
  selectedServices: IntegratedProductService[],
): string[] {
  if (selectedServices.length === 0) {
    return [];
  }

  return keys.filter((key) => {
    const property = schema?.[key];

    if (getProviderConfigFieldScope(key, property) !== 'product') {
      return false;
    }

    const productServices = getProductServicesForProperty(property);

    return selectedServices.some((service) => productServices.includes(service));
  });
}

export interface PlanProductEnvField {
  key: string;
  label: string;
  description?: string | null;
  configName: string;
}

export function collectPlanProductEnvFields(
  configs: Array<{
    id: string;
    name: string;
    environmentVariables?: Array<{
      key: string;
      label: string;
      description?: string | null;
      useRandomDefault?: boolean;
    }>;
  }>,
  selectedConfigIds: string[],
): PlanProductEnvField[] {
  const selected = new Set(selectedConfigIds);
  const fields = new Map<string, PlanProductEnvField>();

  for (const config of configs) {
    if (!selected.has(config.id)) {
      continue;
    }

    for (const env of config.environmentVariables ?? []) {
      if (env.useRandomDefault) {
        continue;
      }

      if (!fields.has(env.key)) {
        fields.set(env.key, {
          key: env.key,
          label: env.label,
          description: env.description ?? null,
          configName: config.name,
        });
      }
    }
  }

  return [...fields.values()];
}
