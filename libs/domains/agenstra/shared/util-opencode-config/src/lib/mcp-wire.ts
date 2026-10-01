import type { JsonObject } from './types';

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Map UI snake_case OAuth onto OpenCode camelCase (`McpOAuthConfig`).
 * Drops unknown keys (OpenCode uses additionalProperties: false).
 */
export function wireMcpOauthForOpenCode(
  oauth: JsonObject,
  options: { includeClientSecret?: boolean } = {},
): JsonObject | undefined {
  const includeClientSecret = options.includeClientSecret === true;
  const next: JsonObject = {};

  const clientId =
    typeof oauth['clientId'] === 'string'
      ? oauth['clientId']
      : typeof oauth['client_id'] === 'string'
        ? oauth['client_id']
        : undefined;

  if (typeof clientId === 'string' && clientId.trim()) {
    next['clientId'] = clientId.trim();
  }

  if (includeClientSecret) {
    const clientSecret =
      typeof oauth['clientSecret'] === 'string'
        ? oauth['clientSecret']
        : typeof oauth['client_secret'] === 'string'
          ? oauth['client_secret']
          : undefined;

    if (typeof clientSecret === 'string' && clientSecret.trim()) {
      next['clientSecret'] = clientSecret.trim();
    }
  }

  const scope = typeof oauth['scope'] === 'string' ? oauth['scope'].trim() : '';

  if (scope) {
    next['scope'] = scope;
  }

  const callbackPort =
    typeof oauth['callbackPort'] === 'number'
      ? oauth['callbackPort']
      : typeof oauth['callback_port'] === 'number'
        ? oauth['callback_port']
        : undefined;

  if (typeof callbackPort === 'number' && Number.isFinite(callbackPort)) {
    next['callbackPort'] = callbackPort;
  }

  const redirectUri =
    typeof oauth['redirectUri'] === 'string'
      ? oauth['redirectUri']
      : typeof oauth['redirect_uri'] === 'string'
        ? oauth['redirect_uri']
        : undefined;

  if (typeof redirectUri === 'string' && redirectUri.trim()) {
    next['redirectUri'] = redirectUri.trim();
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

/** OpenCode local MCP keys only (`additionalProperties: false`). */
const MCP_LOCAL_WIRE_KEYS = new Set(['type', 'command', 'cwd', 'environment', 'enabled', 'timeout']);

/** OpenCode remote MCP keys only (`additionalProperties: false`). */
const MCP_REMOTE_WIRE_KEYS = new Set(['type', 'url', 'enabled', 'headers', 'oauth', 'timeout']);

/**
 * Drop UI-only / unknown MCP fields so OpenCode config validation accepts the payload.
 * Call after secret injection. Keeps `secretEnv`/`secretHeaders` out of the PATCH body.
 */
export function sanitizeMcpWireServer(server: JsonObject): JsonObject {
  const type = typeof server['type'] === 'string' ? server['type'] : 'local';
  const allowed = type === 'remote' ? MCP_REMOTE_WIRE_KEYS : MCP_LOCAL_WIRE_KEYS;
  const next: JsonObject = {};

  for (const key of allowed) {
    if (!(key in server)) {
      continue;
    }

    if (key === 'oauth') {
      if (server['oauth'] === false) {
        next['oauth'] = false;
      } else if (isPlainObject(server['oauth'])) {
        const oauth = wireMcpOauthForOpenCode(server['oauth'] as JsonObject, { includeClientSecret: true });

        if (oauth) {
          next['oauth'] = oauth;
        }
      }

      continue;
    }

    next[key] = server[key];
  }

  return next;
}
