import { VNC_WEBSOCKET_PATH } from '../constants/vnc.constants';

/**
 * Build the Socket.IO URL for the remote agent-manager `socket/agents` namespace.
 * Uses the client endpoint origin (scheme + host + port); HTTP and WebSocket share one port.
 */
export function buildRemoteAgentsSocketUrl(endpoint: string): string {
  const url = new URL(endpoint);
  const protocol = url.protocol === 'https:' ? 'https' : 'http';

  return `${protocol}://${url.host}/socket/agents`;
}

/**
 * Build the raw VNC WebSocket URL on the remote agent-manager.
 * Uses the client endpoint host/port with the shared VNC path.
 */
export function buildRemoteVncWsUrl(endpoint: string): string {
  const url = new URL(endpoint);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

  return `${protocol}//${url.host}${VNC_WEBSOCKET_PATH}`;
}
