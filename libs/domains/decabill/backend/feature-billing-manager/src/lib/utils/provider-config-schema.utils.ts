import {
  IntegratedProvisioningService,
  allIntegratedProvisioningServices,
  canonicalizeIntegratedProvisioningService,
} from './cloud-init/integrated-provisioning-service';

export type ProviderConfigFieldScope = 'server' | 'product' | 'internal';
export type IntegratedProductService = IntegratedProvisioningService;

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

const ALL_INTEGRATED_PRODUCT_SERVICES = allIntegratedProvisioningServices();

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
    const canonical = services
      .map((service) => (typeof service === 'string' ? canonicalizeIntegratedProvisioningService(service) : null))
      .filter((service): service is IntegratedProductService => service !== null);

    return [...new Set(canonical)];
  }

  return [...ALL_INTEGRATED_PRODUCT_SERVICES];
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
  authenticationMethod: [
    IntegratedProvisioningService.AgenstraController,
    IntegratedProvisioningService.AgenstraManager,
    IntegratedProvisioningService.DecabillBilling,
  ],
  staticApiKey: [
    IntegratedProvisioningService.AgenstraController,
    IntegratedProvisioningService.AgenstraManager,
    IntegratedProvisioningService.DecabillBilling,
  ],
  smtp: [
    IntegratedProvisioningService.AgenstraController,
    IntegratedProvisioningService.AgenstraManager,
    IntegratedProvisioningService.DecabillBilling,
  ],
  keycloak: [
    IntegratedProvisioningService.AgenstraController,
    IntegratedProvisioningService.AgenstraManager,
    IntegratedProvisioningService.DecabillBilling,
  ],
  disableSignup: [IntegratedProvisioningService.AgenstraController, IntegratedProvisioningService.DecabillBilling],
  disableForceLogin2fa: [
    IntegratedProvisioningService.AgenstraController,
    IntegratedProvisioningService.DecabillBilling,
  ],
  hetznerApiToken: [IntegratedProvisioningService.AgenstraController, IntegratedProvisioningService.DecabillBilling],
  digitaloceanApiToken: [
    IntegratedProvisioningService.AgenstraController,
    IntegratedProvisioningService.DecabillBilling,
  ],
  git: [IntegratedProvisioningService.AgenstraManager],
  cursorApiKey: [IntegratedProvisioningService.AgenstraManager],
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

      const productServices = PRODUCT_FIELD_SERVICES[key] ?? [...ALL_INTEGRATED_PRODUCT_SERVICES];

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
