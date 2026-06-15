/**
 * Sanitizes provider metadata JSON by removing secrets while keeping
 * provisioning metadata (instance types, location, etc.).
 */

const SECRET_KEYS = new Set([
  'gitToken',
  'gitPassword',
  'gitPrivateKey',
  'cursorApiKey',
  'keycloakClientSecret',
  'apiKey',
  'token',
  'secret',
  'password',
]);
const SECRET_KEY_PATTERNS = [/password/i, /token/i, /secret/i, /key$/i, /credential/i];

/**
 * Check if a key should be removed as it likely contains secrets.
 */
function isSecretKey(key: string): boolean {
  if (SECRET_KEYS.has(key)) {
    return true;
  }

  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Recursively sanitize an object by removing keys that match secret patterns.
 */
function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (isSecretKey(key)) {
      continue;
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      result[key] = sanitizeObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item !== null && typeof item === 'object' && !(item instanceof Date)
          ? sanitizeObject(item as Record<string, unknown>)
          : item,
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Sanitize provider metadata JSON string. Removes secrets (git tokens,
 * passwords, private keys, etc.) but keeps instance type, location, image,
 * and other non-secret provisioning metadata.
 *
 * @param metadataJson - Raw JSON string from provider metadata
 * @returns Sanitized JSON string, or empty object string if invalid
 */
export function sanitizeProviderMetadata(metadataJson: string | undefined): string {
  if (!metadataJson || metadataJson.trim() === '') {
    return '{}';
  }

  try {
    const parsed = JSON.parse(metadataJson) as unknown;

    if (typeof parsed !== 'object' || parsed === null) {
      return '{}';
    }

    const sanitized = sanitizeObject(parsed as Record<string, unknown>);

    return JSON.stringify(sanitized);
  } catch {
    return '{}';
  }
}
