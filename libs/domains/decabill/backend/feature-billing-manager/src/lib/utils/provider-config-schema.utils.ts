export type ProviderConfigFieldScope = 'server' | 'product' | 'internal';
export type IntegratedProductService = 'controller' | 'manager';

export interface ConfigSchemaPropertyDefinition {
  type?: string;
  description?: string;
  enum?: unknown[];
  visible?: boolean;
  scope?: ProviderConfigFieldScope;
  productServices?: IntegratedProductService[];
  properties?: Record<string, unknown>;
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

export function isProviderConfigPropertyVisible(property: ConfigSchemaPropertyDefinition | undefined): boolean {
  return getProviderConfigFieldScope('', property) === 'server';
}

export function splitProviderConfigPropertyKeys(
  schema: Record<string, ConfigSchemaPropertyDefinition> | null | undefined,
  keys: string[],
): { visibleKeys: string[]; collapsedKeys: string[] } {
  const visibleKeys: string[] = [];
  const collapsedKeys: string[] = [];

  for (const key of keys) {
    if (getProviderConfigFieldScope(key, schema?.[key]) === 'server') {
      visibleKeys.push(key);
    } else if (getProviderConfigFieldScope(key, schema?.[key]) === 'product') {
      collapsedKeys.push(key);
    }
  }

  return { visibleKeys, collapsedKeys };
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

export const PRODUCT_FIELD_SERVICES: Record<string, IntegratedProductService[]> = {
  authenticationMethod: ['controller', 'manager'],
  staticApiKey: ['controller', 'manager'],
  smtp: ['controller', 'manager'],
  keycloak: ['controller', 'manager'],
  disableSignup: ['controller'],
  hetznerApiToken: ['controller'],
  digitaloceanApiToken: ['controller'],
  git: ['manager'],
  cursorApiKey: ['manager'],
};

/**
 * Marks provider schema properties with server/product scope for the billing console plan editor.
 */
export function applyProviderConfigFieldScopes(
  properties: Record<string, Record<string, unknown>>,
  serverKeys: string[],
): Record<string, Record<string, unknown>> {
  const serverSet = new Set(serverKeys);

  return Object.fromEntries(
    Object.entries(properties).map(([key, prop]) => {
      if (serverSet.has(key)) {
        return [key, { ...prop, scope: 'server', visible: true }];
      }

      if (INTERNAL_PROVIDER_KEYS.has(key)) {
        return [key, { ...prop, scope: 'internal', visible: false }];
      }

      const productServices = PRODUCT_FIELD_SERVICES[key] ?? ['controller', 'manager'];

      return [key, { ...prop, scope: 'product', visible: false, productServices }];
    }),
  );
}

/** @deprecated Use applyProviderConfigFieldScopes */
export function applyProviderFieldVisibility(
  properties: Record<string, Record<string, unknown>>,
  visibleKeys: string[],
): Record<string, Record<string, unknown>> {
  return applyProviderConfigFieldScopes(properties, visibleKeys);
}
