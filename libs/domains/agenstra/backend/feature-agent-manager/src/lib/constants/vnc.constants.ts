export const VNC_WEBSOCKIFY_PORT = 6080;
export const VNC_TICKET_TTL_MS = 60_000;

/** Path for the raw VNC WebSocket on the shared `WEBSOCKET_PORT` (alongside Socket.IO). */
export const VNC_WEBSOCKET_PATH = '/vnc';

/**
 * Sec-WebSocket-Protocol prefix carrying the one-time VNC ticket.
 * Ticket value is base64url and safe as a protocol token when prefixed.
 */
export const VNC_TICKET_SUBPROTOCOL_PREFIX = 'agenstra.vnc.';

export const MANAGER_WEBSOCKET_PORT_DEFAULT = 8080;
