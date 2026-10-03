/**
 * Resolve WebSocket CORS origin env: WEBSOCKET_CORS_ORIGIN → CORS_ORIGIN → unset.
 * Empty / whitespace-only values are treated as unset.
 */
export function resolveWebsocketCorsOriginEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const websocket = env['WEBSOCKET_CORS_ORIGIN']?.trim();

  if (websocket) {
    return websocket;
  }

  const cors = env['CORS_ORIGIN']?.trim();

  if (cors) {
    return cors;
  }

  return undefined;
}

/**
 * Resolve Socket.IO CORS `origin`: WEBSOCKET_CORS_ORIGIN → CORS_ORIGIN → `*`.
 */
export function resolveWebsocketCorsOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return resolveWebsocketCorsOriginEnv(env) ?? '*';
}
