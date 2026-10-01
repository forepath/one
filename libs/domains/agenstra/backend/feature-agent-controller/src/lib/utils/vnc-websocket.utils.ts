import type { IncomingMessage } from 'http';

/**
 * Validate browser WebSocket Origin against WEBSOCKET_CORS_ORIGIN (comma-separated).
 * - `*` or empty (non-production): allow all
 * - empty in production: allow only requests without Origin (server-to-server)
 * - explicit list: Origin must match when present; missing Origin is allowed (non-browser)
 */
export function isAllowedWebsocketOrigin(
  originHeader: string | string[] | undefined,
  corsOriginEnv: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  const configured = (corsOriginEnv ?? '').trim();
  const isProduction = (nodeEnv || '').trim().toLowerCase() === 'production';

  if (!configured) {
    if (isProduction) {
      return !origin;
    }

    return true;
  }

  if (configured === '*') {
    return true;
  }

  if (!origin) {
    return true;
  }

  const allowed = configured
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return allowed.includes(origin);
}

/** Extract one-time VNC ticket from Sec-WebSocket-Protocol (`{prefix}{ticket}`). */
export function extractVncTicketFromProtocols(request: IncomingMessage, protocolPrefix: string): string {
  const header = request.headers['sec-websocket-protocol'];
  const raw = Array.isArray(header) ? header.join(',') : header || '';
  const protocols = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  for (const protocol of protocols) {
    if (protocol.startsWith(protocolPrefix)) {
      const ticket = protocol.slice(protocolPrefix.length).trim();

      if (ticket.length > 0) {
        return ticket;
      }
    }
  }

  throw new Error('Missing ticket');
}

/** Select a negotiated subprotocol: prefer `binary` (noVNC), else the ticket protocol. */
export function selectVncWebsocketProtocol(protocols: Set<string> | string[], protocolPrefix: string): string | false {
  const list = protocols instanceof Set ? protocols : new Set(protocols);

  if (list.has('binary')) {
    return 'binary';
  }

  for (const protocol of list) {
    if (protocol.startsWith(protocolPrefix)) {
      return protocol;
    }
  }

  return false;
}
