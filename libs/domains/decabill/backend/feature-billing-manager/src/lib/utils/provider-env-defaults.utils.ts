import { ProviderEnvDefaultField } from '../dto/provider-detail.dto';

export const HETZNER_ENV_DEFAULT_FIELDS: ProviderEnvDefaultField[] = [
  { envKey: 'HETZNER_API_TOKEN', label: 'API token', sensitive: true, type: 'string' },
];

export const DIGITALOCEAN_ENV_DEFAULT_FIELDS: ProviderEnvDefaultField[] = [
  { envKey: 'DIGITALOCEAN_API_TOKEN', label: 'API token', sensitive: true, type: 'string' },
];

const PROVIDER_ENV_FIELDS: Record<string, ProviderEnvDefaultField[]> = {
  hetzner: HETZNER_ENV_DEFAULT_FIELDS,
  'digital-ocean': DIGITALOCEAN_ENV_DEFAULT_FIELDS,
};

export interface ProvisioningCredentials {
  apiToken?: string;
}

export function getProviderEnvDefaultFields(providerId: string): ProviderEnvDefaultField[] {
  return PROVIDER_ENV_FIELDS[providerId] ?? [];
}

export function getProviderEnvDefaultFieldKeys(providerId: string): string[] {
  return getProviderEnvDefaultFields(providerId).map((field) => field.envKey);
}

export function sanitizeProviderDefaults(
  input: Record<string, string> | undefined | null,
  allowedKeys: string[],
): Record<string, string> {
  if (!input) {
    return {};
  }

  const allowed = new Set(allowedKeys);
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) {
      continue;
    }

    const trimmed = typeof value === 'string' ? value.trim() : '';

    if (trimmed) {
      result[key] = trimmed;
    }
  }

  return result;
}

export function resolveProviderEnvValue(
  envKey: string,
  providerDefaults: Record<string, string> | null | undefined,
): string | undefined {
  const override = providerDefaults?.[envKey]?.trim();

  if (override) {
    return override;
  }

  const envValue = process.env[envKey]?.trim();

  return envValue || undefined;
}

export function resolveProviderApiToken(
  providerId: string,
  providerDefaults?: Record<string, string> | null,
): string | undefined {
  if (providerId === 'hetzner') {
    return resolveProviderEnvValue('HETZNER_API_TOKEN', providerDefaults);
  }

  if (providerId === 'digital-ocean') {
    return resolveProviderEnvValue('DIGITALOCEAN_API_TOKEN', providerDefaults);
  }

  return undefined;
}

export function getProvisioningCredentials(
  providerId: string,
  providerDefaults?: Record<string, string> | null,
): ProvisioningCredentials {
  const apiToken = resolveProviderApiToken(providerId, providerDefaults);

  return apiToken ? { apiToken } : {};
}

export function maskProviderDefaultsForResponse(
  providerDefaults: Record<string, string> | null | undefined,
  fields: ProviderEnvDefaultField[],
): { providerDefaultsConfigured: Record<string, boolean> } {
  const providerDefaultsConfigured: Record<string, boolean> = {};

  for (const field of fields) {
    providerDefaultsConfigured[field.envKey] = Boolean(providerDefaults?.[field.envKey]?.trim());
  }

  return { providerDefaultsConfigured };
}

export function normalizeStoredProviderDefaults(
  providerDefaults: Record<string, string> | null | undefined,
): Record<string, string> {
  return providerDefaults ?? {};
}
