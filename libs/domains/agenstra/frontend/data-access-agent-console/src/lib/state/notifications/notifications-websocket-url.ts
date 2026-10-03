import type { Environment } from '@forepath/agenstra/frontend/util-configuration';
import { resolveApiWebsocketUrl } from '@forepath/agenstra/frontend/util-configuration';

export function resolveStatusWebsocketUrl(environment: Environment): string | null {
  return resolveApiWebsocketUrl(environment.console.urls.websocket, 'status');
}
