import type { AxiosRequestConfig, RawAxiosRequestHeaders } from 'axios';

/**
 * Header names that must never be copied from caller-supplied {@link AxiosRequestConfig.headers}
 * into outbound agent-manager proxy requests. Service-computed `Authorization` and
 * `Content-Type` are applied after stripping.
 */
const CREDENTIAL_LIKE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-apikey',
  'api-key',
  'cookie',
  'set-cookie',
  'x-auth-token',
  'x-access-token',
  'x-refresh-token',
  'x-csrf-token',
  'x-amz-security-token',
]);

function isCredentialLikeHeaderName(name: string): boolean {
  return CREDENTIAL_LIKE_HEADER_NAMES.has(name.toLowerCase());
}

function normalizeIncomingHeaders(headers: AxiosRequestConfig['headers'] | undefined): Record<string, unknown> {
  if (headers == null) {
    return {};
  }

  const asObject = headers as unknown;

  if (
    typeof asObject === 'object' &&
    asObject !== null &&
    typeof (asObject as { toJSON?: () => unknown }).toJSON === 'function'
  ) {
    const json = (asObject as { toJSON: () => unknown }).toJSON();

    if (json && typeof json === 'object' && !Array.isArray(json)) {
      return { ...(json as Record<string, unknown>) };
    }

    return {};
  }

  if (typeof asObject === 'object' && !Array.isArray(asObject)) {
    return { ...(asObject as Record<string, unknown>) };
  }

  return {};
}

/**
 * Builds headers for HTTP requests from the agent-controller to a client's agent-manager:
 * copies safe headers from `incoming`, drops credential-like names, then sets service `Authorization`
 * and `Content-Type`.
 */
export function buildClientProxyRequestHeaders(
  incoming: AxiosRequestConfig['headers'] | undefined,
  authHeader: string,
  contentType = 'application/json',
): RawAxiosRequestHeaders {
  const flat = normalizeIncomingHeaders(incoming);
  const out: RawAxiosRequestHeaders = {};

  for (const [key, value] of Object.entries(flat)) {
    if (isCredentialLikeHeaderName(key)) {
      continue;
    }

    if (value !== undefined && value !== null) {
      out[key] = value as string | number | boolean;
    }
  }

  out.Authorization = authHeader;
  out['Content-Type'] = contentType;

  return out;
}
