import { NETWORK_SECRET_KEYS, OpencodeConfigValidationError, type JsonObject } from './types';

const CREDENTIAL_KEY_PATTERN = /(password|secret|token|apikey|api_key|accesskey|private[_-]?key|credential)/i;
const NETWORK_SECRET_KEY_SET = new Set<string>(NETWORK_SECRET_KEYS);

/** Primary credential env names used as OpenCode ApiAuth `key`. */
const API_KEY_ENV_PATTERN = /(API_KEY|ACCESS_TOKEN|SECRET_KEY|SECRET|TOKEN)$/i;

/** OpenCode auth payload for `PUT /auth/{providerID}` (ApiAuth). */
export interface ProviderAuthSecret {
  key: string;
  metadata?: Record<string, string>;
}

/** Extracts proxy/CA secrets that must be applied via Docker Env (not auth.set). */
export function extractNetworkSecrets(secrets: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};

  for (const key of NETWORK_SECRET_KEYS) {
    const value = secrets[key];

    if (typeof value === 'string' && value.trim()) {
      out[key] = value;
    }
  }

  return out;
}

/** True when a NODE_EXTRA_CA_CERTS value is inline PEM rather than a filesystem path. */
export function isPemCertificateMaterial(value: string): boolean {
  return value.includes('-----BEGIN') && /CERTIFICATE/i.test(value);
}

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Resolve providers map from either V2 UI shape (`providers`) or OpenCode wire (`provider`).
 */
function resolveProvidersMap(effectiveConfig: JsonObject | null | undefined): JsonObject {
  if (!effectiveConfig) {
    return {};
  }

  const providers = effectiveConfig['providers'];
  const provider = effectiveConfig['provider'];

  if (isPlainObject(providers)) {
    return providers;
  }

  if (isPlainObject(provider)) {
    return provider;
  }

  return {};
}

function ensureStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

/**
 * Map a provider env var name to OpenCode auth metadata key.
 * e.g. AZURE_RESOURCE_NAME + provider `azure` → `resourceName`
 */
export function envNameToAuthMetadataKey(envName: string, providerId: string): string {
  const trimmed = envName.trim();
  const prefix = `${providerId.trim().toUpperCase().replace(/-/g, '_')}_`;
  let rest = trimmed;

  if (rest.toUpperCase().startsWith(prefix)) {
    rest = rest.slice(prefix.length);
  }

  const lower = rest.toLowerCase();

  return lower.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

function isApiKeyEnvName(envName: string): boolean {
  return API_KEY_ENV_PATTERN.test(envName.trim());
}

/**
 * Maps layer secrets to OpenCode `auth.set` payloads keyed by provider id.
 * Skips network proxy/CA keys. Accepts secrets keyed by provider id or by a
 * provider's configured `env` name. Extra env values (e.g. AZURE_RESOURCE_NAME)
 * become ApiAuth `metadata` (e.g. `resourceName`).
 *
 * Supports both UI V2 `providers` and OpenCode wire `provider`.
 */
export function resolveProviderAuthSecrets(
  secrets: Record<string, string>,
  effectiveConfig: JsonObject | null | undefined,
): Record<string, ProviderAuthSecret> {
  const providers = resolveProvidersMap(effectiveConfig);
  const envToProvider = new Map<string, string>();
  const envNamesByProvider = new Map<string, string[]>();

  for (const [providerId, entry] of Object.entries(providers)) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const envNames = ensureStringList(entry['env']);
    envNamesByProvider.set(providerId, envNames);

    for (const name of envNames) {
      envToProvider.set(name, providerId);
    }
  }

  // providerId → { envName or '' (direct) → value }
  const collected = new Map<string, Map<string, string>>();

  const addSecret = (providerId: string, envName: string, value: string): void => {
    if (!value) {
      return;
    }

    let byEnv = collected.get(providerId);

    if (!byEnv) {
      byEnv = new Map();
      collected.set(providerId, byEnv);
    }

    byEnv.set(envName, value);
  };

  for (const [key, value] of Object.entries(secrets)) {
    if (!value || NETWORK_SECRET_KEY_SET.has(key)) {
      continue;
    }

    if (key in providers) {
      // Direct provider-id key — treat as primary API credential.
      addSecret(key, '', value);
      continue;
    }

    const providerId = envToProvider.get(key);

    if (providerId) {
      addSecret(providerId, key, value);
    }
  }

  const authByProvider: Record<string, ProviderAuthSecret> = {};

  for (const [providerId, byEnv] of collected.entries()) {
    const envOrder = envNamesByProvider.get(providerId) ?? [];
    const metadata: Record<string, string> = {};
    let apiKey: string | undefined = byEnv.get('');

    // Prefer an env that looks like an API key.
    for (const envName of envOrder) {
      const value = byEnv.get(envName);

      if (!value) {
        continue;
      }

      if (isApiKeyEnvName(envName)) {
        if (apiKey === undefined) {
          apiKey = value;
        }

        continue;
      }

      metadata[envNameToAuthMetadataKey(envName, providerId)] = value;
    }

    // Remaining env-keyed secrets not listed in envOrder (or leftover API-like names).
    for (const [envName, value] of byEnv.entries()) {
      if (!envName) {
        continue;
      }

      if (isApiKeyEnvName(envName)) {
        if (apiKey === undefined) {
          apiKey = value;
        }

        continue;
      }

      if (envOrder.includes(envName)) {
        continue;
      }

      metadata[envNameToAuthMetadataKey(envName, providerId)] = value;
    }

    // Fallback: first non-empty env value as key when nothing looked like an API key.
    if (apiKey === undefined) {
      for (const envName of envOrder) {
        const value = byEnv.get(envName);

        if (value) {
          apiKey = value;
          delete metadata[envNameToAuthMetadataKey(envName, providerId)];
          break;
        }
      }
    }

    if (apiKey === undefined) {
      for (const [envName, value] of byEnv.entries()) {
        if (envName && value) {
          apiKey = value;
          delete metadata[envNameToAuthMetadataKey(envName, providerId)];
          break;
        }
      }
    }

    if (!apiKey) {
      continue;
    }

    authByProvider[providerId] = Object.keys(metadata).length > 0 ? { key: apiKey, metadata } : { key: apiKey };
  }

  return authByProvider;
}

/**
 * Maps layer secrets onto provider `env` names for Docker container Env.
 * OpenCode reads several credentials (e.g. AZURE_RESOURCE_NAME) from process env
 * even when ApiAuth is also set via auth.set.
 *
 * Returns:
 * - `values` — env vars that should be set (non-empty secrets)
 * - `managedKeys` — all env names declared on configured providers (for clearing stale values)
 */
export function extractProviderEnvSecrets(
  secrets: Record<string, string>,
  effectiveConfig: JsonObject | null | undefined,
): { values: Record<string, string>; managedKeys: string[] } {
  const providers = resolveProvidersMap(effectiveConfig);
  const managed = new Set<string>();
  const values: Record<string, string> = {};

  for (const entry of Object.values(providers)) {
    if (!isPlainObject(entry)) {
      continue;
    }

    for (const name of ensureStringList(entry['env'])) {
      managed.add(name);

      const value = secrets[name];

      if (typeof value === 'string' && value.trim()) {
        values[name] = value;
      }
    }
  }

  return { values, managedKeys: [...managed].sort() };
}

export function assertNoCredentialKeysInConfig(config: JsonObject | null | undefined): void {
  if (!config) {
    return;
  }

  const stack: Array<{ path: string; value: unknown }> = [{ path: '', value: config }];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current) {
      continue;
    }

    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        if (item && typeof item === 'object') {
          stack.push({ path: `${current.path}[${index}]`, value: item });
        }
      });
      continue;
    }

    if (!current.value || typeof current.value !== 'object') {
      continue;
    }

    for (const [key, value] of Object.entries(current.value as JsonObject)) {
      const path = current.path ? `${current.path}.${key}` : key;

      if (CREDENTIAL_KEY_PATTERN.test(key)) {
        throw new OpencodeConfigValidationError(`Credential-like key '${path}' must be stored in secrets, not config`);
      }

      if (value && typeof value === 'object') {
        stack.push({ path, value });
      }
    }
  }
}
